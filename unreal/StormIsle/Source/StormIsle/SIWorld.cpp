#include "SIWorld.h"
#include "SIUtil.h"
#include "ProceduralMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/SkyLight.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	float Fbm(FVector2D P, int32 Octaves = 5)
	{
		float Amp = 1.f, Freq = 1.f, Sum = 0.f, Norm = 0.f;
		for (int32 i = 0; i < Octaves; ++i)
		{
			Sum += Amp * FMath::PerlinNoise2D(P * Freq + FVector2D(37.2f, 11.7f) * (i + 1));
			Norm += Amp;
			Amp *= 0.5f;
			Freq *= 2.03f;
		}
		return Sum / Norm;
	}

	/** Adds a triangle wound so that its front faces along Outward. */
	void AddTri(TArray<int32>& Tris, const TArray<FVector>& V, int32 A, int32 B, int32 C, const FVector& Outward)
	{
		const FVector N = (V[C] - V[A]) ^ (V[B] - V[A]);
		if ((N | Outward) < 0.f)
		{
			Swap(B, C);
		}
		Tris.Add(A);
		Tris.Add(B);
		Tris.Add(C);
	}
}

ASIWorld::ASIWorld()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Terrain = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Terrain"));
	Terrain->SetupAttachment(RootComponent);
	Terrain->bUseAsyncCooking = false;
}

float ASIWorld::HeightAt(float X, float Y)
{
	const FVector2D P(X, Y);
	// A wobbly coastline: the island's edge comes and goes with the angle around the centre.
	const float Wobble = 1.f + 0.18f * Fbm(P.GetSafeNormal() * 3.f + FVector2D(5.f, 2.f), 3);
	const float D = P.Size() / (IslandRadius * Wobble);
	const float Shape = 1.f - FMath::SmoothStep(0.55f, 1.05f, D);

	const float Rolling = (Fbm(P / 38000.f) * 0.5f + 0.5f) * 2600.f;
	const float Small = Fbm(P / 6000.f, 3) * 180.f;
	// A ridge of hills to the north, with one peak.
	const FVector2D Peak(30000.f, 70000.f);
	const float Mountain = 9000.f * FMath::Exp(-FVector2D::DistSquared(P, Peak) / (2.f * 26000.f * 26000.f))
		* (0.75f + 0.25f * Fbm(P / 9000.f, 3));
	// Keep the meadow where the player starts gentle.
	const float Meadow = 1.f - 0.6f * FMath::Exp(-FVector2D::DistSquared(P, FVector2D(0.f, -60000.f)) / (2.f * 30000.f * 30000.f));

	const float Land = (300.f + Rolling * Meadow + Small + Mountain) * Shape;
	return Land - (1.f - Shape) * 2500.f;
}

FVector ASIWorld::NormalAt(float X, float Y)
{
	const float E = 150.f;
	return FVector(HeightAt(X - E, Y) - HeightAt(X + E, Y), HeightAt(X, Y - E) - HeightAt(X, Y + E), 2.f * E).GetSafeNormal();
}

FVector ASIWorld::StartLocation()
{
	const float X = 4000.f, Y = -95000.f;
	return FVector(X, Y, HeightAt(X, Y) + 120.f);
}

void ASIWorld::BeginPlay()
{
	Super::BeginPlay();
	BuildSky();
	BuildOcean();
	BuildTerrain();
}

void ASIWorld::BuildSky()
{
	UWorld* W = GetWorld();
	if (ADirectionalLight* L = W->SpawnActor<ADirectionalLight>(FVector(0, 0, 100000), FRotator(-40.f, 35.f, 0.f)))
	{
		Sun = L->GetComponent();
		Sun->SetMobility(EComponentMobility::Movable);
		Sun->SetIntensity(8.f);
		Sun->SetAtmosphereSunLight(true);
		Sun->SetAtmosphereSunLightIndex(0);
		Sun->SetForwardShadingPriority(1);
	}
	if (ADirectionalLight* L = W->SpawnActor<ADirectionalLight>(FVector(0, 0, 100000), FRotator(-50.f, 200.f, 0.f)))
	{
		// A cool, dim moon so nights are dark but not black.
		Moon = L->GetComponent();
		Moon->SetMobility(EComponentMobility::Movable);
		Moon->SetIntensity(0.f);
		Moon->SetLightColor(FLinearColor(0.55f, 0.65f, 1.f));
		Moon->SetAtmosphereSunLight(false);   // lights the ground only; the night sky stays dark
		Moon->SetForwardShadingPriority(0);
	}
	W->SpawnActor<ASkyAtmosphere>(FVector::ZeroVector, FRotator::ZeroRotator);
	W->SpawnActor<AVolumetricCloud>(FVector::ZeroVector, FRotator::ZeroRotator);
	if (ASkyLight* Sky = W->SpawnActor<ASkyLight>(FVector(0, 0, 100000), FRotator::ZeroRotator))
	{
		SkyLight = Sky->GetLightComponent();
		SkyLight->SetMobility(EComponentMobility::Movable);
		SkyLight->bRealTimeCapture = true;
		SkyLight->MarkRenderStateDirty();
	}
	if (APostProcessVolume* PP = W->SpawnActor<APostProcessVolume>(FVector::ZeroVector, FRotator::ZeroRotator))
	{
		// The eye adapts, but not so far that night looks like day.
		PP->bUnbound = true;
		PP->Settings.bOverride_AutoExposureMinBrightness = true;
		PP->Settings.bOverride_AutoExposureMaxBrightness = true;
		PP->Settings.AutoExposureMinBrightness = 6.f;
		PP->Settings.AutoExposureMaxBrightness = 15.f;
	}
	if (AExponentialHeightFog* F = W->SpawnActor<AExponentialHeightFog>(FVector(0, 0, 0), FRotator::ZeroRotator))
	{
		Fog = F->GetComponent();
		Fog->SetFogDensity(0.004f);
		Fog->SetFogHeightFalloff(0.1f);
	}
}

void ASIWorld::BuildOcean()
{
	AStaticMeshActor* Sea = GetWorld()->SpawnActor<AStaticMeshActor>(FVector(0, 0, 0), FRotator::ZeroRotator);
	if (!Sea)
	{
		return;
	}
	UStaticMeshComponent* C = Sea->GetStaticMeshComponent();
	C->SetMobility(EComponentMobility::Movable);
	C->SetStaticMesh(Isle::Mesh(TEXT("Plane")));
	Sea->SetActorScale3D(FVector(20000.f, 20000.f, 1.f)); // 20 km of sea
	C->SetMaterial(0, Isle::Tinted(TEXT("M_Water"), FLinearColor(0.01f, 0.08f, 0.12f), this));
	C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void ASIWorld::BuildTerrain()
{
	const int32 Cells = 420;
	const float Size = IslandRadius * 2.6f;
	const float Step = Size / Cells;
	const float Origin = -Size * 0.5f;
	const int32 Row = Cells + 1;

	TArray<FVector> Verts, Normals;
	TArray<FVector2D> UVs;
	TArray<FLinearColor> Colours;
	TArray<FProcMeshTangent> Tangents;
	TArray<int32> Tris;
	Verts.Reserve(Row * Row);

	const FLinearColor Sand(0.48f, 0.40f, 0.25f), Grass(0.09f, 0.20f, 0.035f), Dry(0.22f, 0.24f, 0.07f),
		Rock(0.16f, 0.15f, 0.13f), Seabed(0.20f, 0.18f, 0.12f);
	for (int32 iy = 0; iy < Row; ++iy)
	{
		for (int32 ix = 0; ix < Row; ++ix)
		{
			const float X = Origin + ix * Step, Y = Origin + iy * Step;
			const float H = HeightAt(X, Y);
			Verts.Add(FVector(X, Y, H));
			const FVector N = NormalAt(X, Y);
			Normals.Add(N);
			UVs.Add(FVector2D(ix, iy));
			Tangents.Add(FProcMeshTangent(1.f, 0.f, 0.f));

			FLinearColor C = FMath::Lerp(Grass, Dry, FMath::Clamp(FMath::PerlinNoise2D(FVector2D(X, Y) / 15000.f) + 0.3f, 0.f, 1.f));
			C = FMath::Lerp(Sand, C, FMath::SmoothStep(120.f, 420.f, H));
			C = FMath::Lerp(C, Rock, FMath::Max(FMath::SmoothStep(5500.f, 7500.f, H), 1.f - FMath::SmoothStep(0.72f, 0.86f, float(N.Z))));
			if (H < 0.f)
			{
				C = FMath::Lerp(Sand, Seabed, FMath::SmoothStep(0.f, 800.f, -H));
			}
			Colours.Add(C);
		}
	}
	for (int32 iy = 0; iy < Cells; ++iy)
	{
		for (int32 ix = 0; ix < Cells; ++ix)
		{
			const int32 A = iy * Row + ix, B = A + 1, C = A + Row, D = C + 1;
			AddTri(Tris, Verts, A, C, B, FVector::UpVector);
			AddTri(Tris, Verts, B, C, D, FVector::UpVector);
		}
	}
	Terrain->CreateMeshSection_LinearColor(0, Verts, Tris, Normals, UVs, Colours, Tangents, true);
	Terrain->SetMaterial(0, Isle::Mat(TEXT("M_Terrain")));
	Terrain->SetCollisionProfileName(TEXT("BlockAll"));
}

float ASIWorld::Daylight() const
{
	return FMath::SmoothStep(0.20f, 0.30f, TimeOfDay) * (1.f - FMath::SmoothStep(0.70f, 0.80f, TimeOfDay));
}

FString ASIWorld::ClockText() const
{
	const int32 Minutes = FMath::FloorToInt32(TimeOfDay * 24.f * 60.f);
	return FString::Printf(TEXT("第 %d 天　%02d:%02d"), Day, Minutes / 60, Minutes % 60);
}

void ASIWorld::Tick(float Dt)
{
	Super::Tick(Dt);
	TimeOfDay += Dt / DayLength;
	if (TimeOfDay >= 1.f)
	{
		TimeOfDay -= 1.f;
		++Day;
	}
	Gloom = FMath::FInterpTo(Gloom, StormGloom, Dt, 1.5f);

	// The sun climbs from the east, crosses the south and sets in the west; the moon is opposite.
	const float Angle = (TimeOfDay - 0.25f) * 360.f;
	const float Elevation = FMath::Sin(FMath::DegreesToRadians(Angle)) * 62.f;
	const float Light = Daylight();
	if (Sun)
	{
		Sun->SetWorldRotation(FRotator(-Elevation, 90.f + Angle * 0.5f, 0.f));
		Sun->SetIntensity(FMath::Max(Light, 0.02f) * 9.f * (1.f - 0.85f * Gloom));
		Sun->SetLightColor(FMath::Lerp(FLinearColor(1.f, 0.55f, 0.3f), FLinearColor(1.f, 0.96f, 0.9f), FMath::Min(Light * 1.5f, 1.f)));
	}
	if (Moon)
	{
		Moon->SetWorldRotation(FRotator(-FMath::Max(-Elevation, 15.f), 270.f + Angle * 0.5f, 0.f));
		Moon->SetIntensity((1.f - Light) * 0.35f);
	}
	if (Fog)
	{
		// The storm closes in: thick violet murk.
		Fog->SetFogDensity(FMath::Lerp(0.004f, 0.05f, Gloom));
		Fog->SetFogInscatteringColor(FMath::Lerp(FLinearColor(0.45f, 0.55f, 0.7f) * FMath::Max(Light, 0.1f), FLinearColor(0.12f, 0.03f, 0.22f), Gloom));
	}
	if (SkyLight)
	{
		SkyLight->SetIntensity(FMath::Lerp(1.f, 0.35f, Gloom) * FMath::Lerp(0.12f, 1.f, Light));
	}
}
