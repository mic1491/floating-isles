#include "DragonWorld.h"
#include "DragonPawn.h"
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
#include "Engine/ExponentialHeightFog.h"
#include "Engine/StaticMeshActor.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	const float RingRadius = 2600.f;
	const float RingTube = 160.f;
	const int32 RingCount = 24;

	float Fbm(FVector2D P)
	{
		float Amp = 1.f, Freq = 1.f, Sum = 0.f, Norm = 0.f;
		for (int32 i = 0; i < 5; ++i)
		{
			Sum += Amp * FMath::PerlinNoise2D(P * Freq + FVector2D(37.2f, 11.7f) * (i + 1));
			Norm += Amp;
			Amp *= 0.5f;
			Freq *= 2.03f;
		}
		return Sum / Norm;
	}

	UMaterialInterface* LoadMat(const TCHAR* Path)
	{
		UMaterialInterface* M = LoadObject<UMaterialInterface>(nullptr, Path, nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!M)
		{
			// Before Tools/setup_assets.py has been run the project materials do not exist yet.
			M = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
		}
		return M;
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

ADragonWorld::ADragonWorld()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Terrain = CreateDefaultSubobject<UProceduralMeshComponent>(TEXT("Terrain"));
	Terrain->SetupAttachment(RootComponent);
	Terrain->bUseAsyncCooking = false;
}

float ADragonWorld::HeightAt(float X, float Y)
{
	const FVector2D P(X, Y);
	float N = Fbm(P / 350000.f) * 1.8f;
	const float D = P.Size() / PlayRadius;
	N -= FMath::SmoothStep(0.75f, 1.0f, D) * 1.5f;
	return N > 0.f ? FMath::Pow(N, 1.4f) * 200000.f : N * 40000.f;
}

FVector ADragonWorld::StartLocation()
{
	return FVector(0.f, 0.f, FMath::Max(HeightAt(0.f, 0.f), 0.f) + 50000.f);
}

void ADragonWorld::BeginPlay()
{
	Super::BeginPlay();
	TerrainMat = LoadMat(TEXT("/Game/Materials/M_Terrain.M_Terrain"));
	GlowMat = LoadMat(TEXT("/Game/Materials/M_Glow.M_Glow"));
	WaterMat = LoadMat(TEXT("/Game/Materials/M_Water.M_Water"));
	BuildSky();
	BuildOcean();
	BuildTerrain();
	BuildRings();
	BuildTargets();
}

void ADragonWorld::BuildSky()
{
	UWorld* W = GetWorld();

	if (ADirectionalLight* Sun = W->SpawnActor<ADirectionalLight>(FVector(0, 0, 100000), FRotator(-38.f, 35.f, 0.f)))
	{
		Sun->GetLightComponent()->SetMobility(EComponentMobility::Movable);
		Sun->GetLightComponent()->SetIntensity(8.f);
	}
	W->SpawnActor<ASkyAtmosphere>(FVector::ZeroVector, FRotator::ZeroRotator);
	W->SpawnActor<AVolumetricCloud>(FVector::ZeroVector, FRotator::ZeroRotator);

	if (ASkyLight* Sky = W->SpawnActor<ASkyLight>(FVector(0, 0, 100000), FRotator::ZeroRotator))
	{
		USkyLightComponent* C = Sky->GetLightComponent();
		C->SetMobility(EComponentMobility::Movable);
		C->bRealTimeCapture = true;
		C->MarkRenderStateDirty();
	}
	if (AExponentialHeightFog* Fog = W->SpawnActor<AExponentialHeightFog>(FVector(0, 0, 0), FRotator::ZeroRotator))
	{
		Fog->GetComponent()->SetFogDensity(0.0006f);
		Fog->GetComponent()->SetFogHeightFalloff(0.05f);
	}
}

void ADragonWorld::BuildOcean()
{
	AStaticMeshActor* Sea = GetWorld()->SpawnActor<AStaticMeshActor>(FVector::ZeroVector, FRotator::ZeroRotator);
	if (!Sea)
	{
		return;
	}
	UStaticMeshComponent* C = Sea->GetStaticMeshComponent();
	C->SetMobility(EComponentMobility::Movable);
	C->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Plane.Plane")));
	Sea->SetActorScale3D(FVector(100000.f, 100000.f, 1.f)); // the plane is 1 m, this makes it 100 km
	UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(WaterMat, this);
	M->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.01f, 0.09f, 0.16f));
	C->SetMaterial(0, M);
}

void ADragonWorld::BuildTerrain()
{
	const int32 Cells = 440;
	const float Step = 2.f * PlayRadius * 1.1f / Cells;
	const float Origin = -Step * Cells * 0.5f;
	const int32 Row = Cells + 1;

	TArray<FVector> Verts;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	TArray<FLinearColor> Colours;
	TArray<FProcMeshTangent> Tangents;
	TArray<int32> Tris;
	Verts.Reserve(Row * Row);

	const FLinearColor Sand(0.42f, 0.35f, 0.20f), Grass(0.045f, 0.15f, 0.02f), Rock(0.12f, 0.105f, 0.09f), Snow(0.80f, 0.83f, 0.90f);
	for (int32 iy = 0; iy < Row; ++iy)
	{
		for (int32 ix = 0; ix < Row; ++ix)
		{
			const float X = Origin + ix * Step, Y = Origin + iy * Step;
			const float H = HeightAt(X, Y);
			Verts.Add(FVector(X, Y, H));
			const float E = Step * 0.5f;
			const FVector N = FVector(HeightAt(X - E, Y) - HeightAt(X + E, Y), HeightAt(X, Y - E) - HeightAt(X, Y + E), 2.f * E).GetSafeNormal();
			Normals.Add(N);
			UVs.Add(FVector2D(ix, iy));
			Tangents.Add(FProcMeshTangent(1.f, 0.f, 0.f));

			FLinearColor C = FMath::Lerp(Sand, Grass, FMath::SmoothStep(800.f, 5000.f, H));
			C = FMath::Lerp(C, Rock, FMath::Max(FMath::SmoothStep(45000.f, 80000.f, H), 1.f - FMath::SmoothStep(0.60f, 0.80f, float(N.Z))));
			C = FMath::Lerp(C, Snow, FMath::SmoothStep(95000.f, 120000.f, H));
			if (H < 800.f)
			{
				C = Sand;
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
	Terrain->SetMaterial(0, TerrainMat);
	Terrain->SetCollisionProfileName(TEXT("BlockAll"));
}

void ADragonWorld::BuildRings()
{
	// A winding course that starts in front of the dragon and stays above the ground.
	FVector Pos = StartLocation();
	float Yaw = 0.f;
	for (int32 i = 0; i < RingCount; ++i)
	{
		Yaw += 28.f * FMath::Sin(i * 0.9f) + 9.f;
		const FVector Dir = FRotator(0.f, Yaw, 0.f).Vector();
		Pos += Dir * (i == 0 ? 15000.f : 20000.f);
		const float Ground = FMath::Max(HeightAt(Pos.X, Pos.Y), 0.f);
		const float Wanted = Ground + 15000.f + 6000.f * FMath::Sin(i * 1.7f);
		Pos.Z = FMath::Max(FMath::Lerp(float(Pos.Z), Wanted, 0.6f), Ground + 8000.f);
		Rings.Add(FTransform(FRotator(0.f, Yaw, 0.f), Pos));
	}

	// One torus, whose axis is local X, reused for every ring.
	const int32 Major = 48, Minor = 12;
	TArray<FVector> Verts, Normals;
	TArray<FVector2D> UVs;
	TArray<FLinearColor> Colours;
	TArray<FProcMeshTangent> Tangents;
	TArray<int32> Tris;
	for (int32 i = 0; i < Major; ++i)
	{
		const float T = 2.f * PI * i / Major;
		const FVector Radial(0.f, FMath::Cos(T), FMath::Sin(T));
		for (int32 j = 0; j < Minor; ++j)
		{
			const float P = 2.f * PI * j / Minor;
			const FVector N = Radial * FMath::Cos(P) + FVector::ForwardVector * FMath::Sin(P);
			Verts.Add(Radial * RingRadius + N * RingTube);
			Normals.Add(N);
			UVs.Add(FVector2D(float(i) / Major, float(j) / Minor));
			Colours.Add(FLinearColor::White);
			Tangents.Add(FProcMeshTangent(0.f, -FMath::Sin(T), FMath::Cos(T)));
		}
	}
	for (int32 i = 0; i < Major; ++i)
	{
		for (int32 j = 0; j < Minor; ++j)
		{
			const int32 A = i * Minor + j, B = i * Minor + (j + 1) % Minor;
			const int32 C = ((i + 1) % Major) * Minor + j, D = ((i + 1) % Major) * Minor + (j + 1) % Minor;
			AddTri(Tris, Verts, A, B, C, Normals[A]);
			AddTri(Tris, Verts, B, D, C, Normals[D]);
		}
	}

	for (const FTransform& R : Rings)
	{
		UProceduralMeshComponent* Mesh = NewObject<UProceduralMeshComponent>(this);
		Mesh->SetupAttachment(RootComponent);
		Mesh->RegisterComponent();
		Mesh->SetWorldTransform(R);
		Mesh->CreateMeshSection_LinearColor(0, Verts, Tris, Normals, UVs, Colours, Tangents, false);
		Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Mesh->SetCastShadow(false);
		UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(GlowMat, this);
		Mesh->SetMaterial(0, M);
		RingMeshes.Add(Mesh);
		RingMats.Add(M);
	}
	RefreshRingColours();
}

void ADragonWorld::BuildTargets()
{
	UStaticMesh* Ball = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	// One or two beside each stretch of the course, off to alternating sides.
	for (int32 i = 0; i + 1 < Rings.Num(); ++i)
	{
		for (int32 k = 0; k < (i % 3 == 0 ? 2 : 1); ++k)
		{
			const FVector A = Rings[i].GetLocation(), B = Rings[i + 1].GetLocation();
			const FVector Side = ((B - A) ^ FVector::UpVector).GetSafeNormal() * ((i + k) % 2 ? 1.f : -1.f);
			FVector P = FMath::Lerp(A, B, 0.35f + 0.3f * k) + Side * (5000.f + 2500.f * k);
			P.Z = FMath::Max(P.Z + 2500.f * FMath::Sin(i * 2.3f + k), FMath::Max(HeightAt(P.X, P.Y), 0.f) + 5000.f);

			UStaticMeshComponent* C = NewObject<UStaticMeshComponent>(this);
			C->SetupAttachment(RootComponent);
			C->RegisterComponent();
			C->SetStaticMesh(Ball);
			C->SetWorldLocation(P);
			C->SetWorldScale3D(FVector(9.f)); // 9 m across
			C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			C->SetCastShadow(false);
			UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(GlowMat, this);
			M->SetVectorParameterValue(TEXT("Color"), FLinearColor(1.f, 0.07f, 0.02f));
			C->SetMaterial(0, M);
			Targets.Add(C);
		}
	}
}

void ADragonWorld::RefreshRingColours()
{
	for (int32 i = 0; i < RingMeshes.Num(); ++i)
	{
		RingMeshes[i]->SetVisibility(i >= NextRing);
		const bool bNext = i == NextRing;
		RingMats[i]->SetVectorParameterValue(TEXT("Color"), bNext ? FLinearColor(1.0f, 0.65f, 0.05f) : FLinearColor(0.05f, 0.45f, 0.6f));
		RingMeshes[i]->SetWorldScale3D(FVector(bNext ? 1.15f : 1.f));
	}
}

bool ADragonWorld::GetNextRingLocation(FVector& Out) const
{
	if (!Rings.IsValidIndex(NextRing))
	{
		return false;
	}
	Out = Rings[NextRing].GetLocation();
	return true;
}

void ADragonWorld::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	ADragonPawn* Dragon = Cast<ADragonPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!Dragon)
	{
		return;
	}
	if (bStarted && !bFinished)
	{
		CourseTime += DeltaSeconds;
	}

	const FVector Cur = Dragon->GetActorLocation();
	if (bHavePrev && Rings.IsValidIndex(NextRing))
	{
		const FVector C = Rings[NextRing].GetLocation();
		const FVector N = Rings[NextRing].GetRotation().GetForwardVector();
		const float D0 = (PrevPawnPos - C) | N;
		const float D1 = (Cur - C) | N;
		if (D0 * D1 <= 0.f && D0 != D1)
		{
			// Where the flight path crossed the ring's plane.
			const FVector Hit = FMath::Lerp(PrevPawnPos, Cur, D0 / (D0 - D1));
			if (FVector::Dist(Hit, C) < RingRadius * 1.15f)
			{
				bStarted = true;
				++NextRing;
				bFinished = NextRing >= Rings.Num();
				Dragon->Boost();
				RefreshRingColours();
			}
		}
	}
	PrevPawnPos = Cur;
	bHavePrev = true;

	// Lanterns bob gently, and burn up when caught in the cone of the dragon's breath.
	Clock += DeltaSeconds;
	const bool bFire = Dragon->IsBreathingFire();
	const FVector Mouth = Dragon->GetMouthLocation(), FireDir = Dragon->GetFireDirection();
	for (int32 i = 0; i < Targets.Num(); ++i)
	{
		UStaticMeshComponent* T = Targets[i];
		if (!T->IsVisible())
		{
			continue;
		}
		T->SetWorldScale3D(FVector(9.f + 0.8f * FMath::Sin(Clock * 2.f + i)));
		if (bFire)
		{
			const FVector To = T->GetComponentLocation() - Mouth;
			const float Dist = To.Size();
			if (Dist < 11000.f && (To | FireDir) > Dist * 0.955f) // within about 17 degrees
			{
				T->SetVisibility(false);
				++Burned;
				Dragon->FireBurst(T->GetComponentLocation());
			}
		}
	}
}
