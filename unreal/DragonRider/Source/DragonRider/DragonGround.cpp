#include "DragonGround.h"
#include "DragonPawn.h"
#include "DragonProps.h"
#include "DragonWorld.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Math/RandomStream.h"

namespace
{
	const float GrassCell = 3000.f;     // grass is laid out in 30 m squares
	const int32 GrassReach = 5;         // this many squares out from the dragon's
	const int32 GrassPerCell = 110;
	const float GrassMaxAltitude = 30000.f; // above this height over the ground it would not be seen
	const FString Kite(TEXT("/Game/KiteDemo/Environments/"));

	/** Steepness of the ground at a point: 1 is flat, 0 a sheer wall. */
	float Flatness(float X, float Y, float Reach)
	{
		const float Dx = ADragonWorld::HeightAt(X + Reach, Y) - ADragonWorld::HeightAt(X - Reach, Y);
		const float Dy = ADragonWorld::HeightAt(X, Y + Reach) - ADragonWorld::HeightAt(X, Y - Reach);
		return FVector(-Dx, -Dy, 2.f * Reach).GetSafeNormal().Z;
	}
}

ADragonGround::ADragonGround()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

bool ADragonGround::AddKind(TArray<FKind>& Into, const TCHAR* Path, float MinScale, float MaxScale, float Sink, bool bShadow, int32 CullFrom, int32 CullTo)
{
	const FString Full = Kite + Path;
	UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *Full, nullptr, LOAD_NoWarn | LOAD_Quiet);
	if (!Mesh)
	{
		return false;
	}
	FKind K;
	K.MinScale = MinScale;
	K.MaxScale = MaxScale;
	K.Sink = Sink;
	K.Height = Mesh->GetBounds().BoxExtent.Z * 2.f;
	K.Mesh = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
	K.Mesh->SetupAttachment(RootComponent);
	K.Mesh->RegisterComponent();
	K.Mesh->SetStaticMesh(Mesh);
	K.Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	K.Mesh->SetCastShadow(bShadow);
	K.Mesh->SetCullDistances(CullFrom, CullTo);
	Into.Add(K);
	return true;
}

bool ADragonGround::NearVillage(const FVector2D& P, float Radius) const
{
	if (Props)
	{
		for (const FVector2D& V : Props->GetVillages())
		{
			if (FVector2D::DistSquared(V, P) < Radius * Radius)
			{
				return true;
			}
		}
	}
	return false;
}

void ADragonGround::PlaceRocks()
{
	// Boulders: scaled well up, so they read as crags from the air.
	AddKind(Boulders, TEXT("Rocks/LargePlainsBoulder002/SM_LargePlainsBoulder002.SM_LargePlainsBoulder002"), 1.2f, 3.5f, 0.3f, true, 0, 0);
	AddKind(Boulders, TEXT("Rocks/Large_Volcanic_Rock_001/LargeVolcanicRock_001.LargeVolcanicRock_001"), 1.5f, 4.f, 0.25f, true, 0, 0);
	AddKind(Boulders, TEXT("Rocks/Large_Volcanic_Rock_001/LargeVolcanicRock_003.LargeVolcanicRock_003"), 1.5f, 4.f, 0.25f, true, 0, 0);
	AddKind(Boulders, TEXT("Rocks/Mountain_RockFace_002/SM_MountainRock_Closed.SM_MountainRock_Closed"), 1.5f, 5.f, 0.3f, true, 0, 0);
	AddKind(Boulders, TEXT("Rocks/Medium_Boulder_001/Medium_Boulder_001.Medium_Boulder_001"), 1.5f, 4.f, 0.2f, true, 0, 0);
	AddKind(Scree, TEXT("Rocks/Scree002/SM_Scree002_NEW.SM_Scree002_NEW"), 1.5f, 3.f, 0.15f, false, 250000, 320000);
	AddKind(Scree, TEXT("Rocks/Scree001/Scree_001.Scree_001"), 1.5f, 3.f, 0.15f, false, 250000, 320000);
	AddKind(Shore, TEXT("Rocks/River_Rock_01/SM_River_Rock_01.SM_River_Rock_01"), 4.f, 10.f, 0.35f, true, 200000, 260000);
	AddKind(Shore, TEXT("Rocks/Boulder_05a/SM_Boulder05a.SM_Boulder05a"), 3.f, 9.f, 0.35f, true, 200000, 260000);
	AddKind(Shore, TEXT("Rocks/Medium_Boulder_002/Medium_Boulder_LowPoly.Medium_Boulder_LowPoly"), 1.f, 2.5f, 0.3f, true, 200000, 260000);
	if (Boulders.Num() == 0)
	{
		return;
	}

	FRandomStream Rng(424242);
	const float R = ADragonWorld::PlayRadius;
	const float Step = 3500.f;
	TArray<TArray<FTransform>> Out[3];
	Out[0].SetNum(Boulders.Num());
	Out[1].SetNum(Scree.Num());
	Out[2].SetNum(Shore.Num());
	auto Put = [&Rng](const TArray<FKind>& Kinds, TArray<TArray<FTransform>>& Into, float X, float Y, float G, float Tilt)
	{
		if (Kinds.Num() == 0)
		{
			return;
		}
		const int32 K = Rng.RandRange(0, Kinds.Num() - 1);
		const float Scale = Rng.FRandRange(Kinds[K].MinScale, Kinds[K].MaxScale);
		const FRotator Rot(Rng.FRandRange(-Tilt, Tilt), Rng.FRandRange(0.f, 360.f), Rng.FRandRange(-Tilt, Tilt));
		Into[K].Add(FTransform(Rot, FVector(X, Y, G - Kinds[K].Height * Scale * Kinds[K].Sink), FVector(Scale)));
	};
	for (float Y = -R; Y < R; Y += Step)
	{
		for (float X = -R; X < R; X += Step)
		{
			const float PX = X + Rng.FRandRange(-0.45f, 0.45f) * Step, PY = Y + Rng.FRandRange(-0.45f, 0.45f) * Step;
			const float G = ADragonWorld::HeightAt(PX, PY);
			if (G < 0.f || NearVillage(FVector2D(PX, PY), 9000.f))
			{
				continue;
			}
			const float Flat = Flatness(PX, PY, 600.f);
			// Rocky ground comes in broad patches; more of it the higher and steeper the land.
			const float Rocky = FMath::PerlinNoise2D(FVector2D(PX, PY) / 60000.f + FVector2D(17.3f, 4.1f)) + G / 120000.f + (1.f - Flat) * 0.8f;
			if (G < 900.f)
			{
				if (Rng.FRand() < 0.10f)
				{
					Put(Shore, Out[2], PX, PY, G, 20.f); // stones along the beaches
				}
			}
			else if (Flat < 0.78f && Rng.FRand() < 0.5f * Rocky)
			{
				Put(Scree, Out[1], PX, PY, G, 12.f); // loose stone on the steep faces
				if (Rng.FRand() < 0.3f)
				{
					Put(Boulders, Out[0], PX, PY, G, 25.f);
				}
			}
			else if (Rng.FRand() < 0.16f * FMath::Max(Rocky, 0.f))
			{
				Put(Boulders, Out[0], PX, PY, G, 25.f);
			}
		}
	}
	for (int32 i = 0; i < Boulders.Num(); ++i) { Boulders[i].Mesh->AddInstances(Out[0][i], false, true); }
	for (int32 i = 0; i < Scree.Num(); ++i) { Scree[i].Mesh->AddInstances(Out[1][i], false, true); }
	for (int32 i = 0; i < Shore.Num(); ++i) { Shore[i].Mesh->AddInstances(Out[2][i], false, true); }
}

void ADragonGround::PlaceGrass(const FIntPoint& Centre)
{
	TArray<TArray<FTransform>> Out;
	Out.SetNum(Grass.Num());
	for (int32 cy = -GrassReach; cy <= GrassReach; ++cy)
	{
		for (int32 cx = -GrassReach; cx <= GrassReach; ++cx)
		{
			if (cx * cx + cy * cy > GrassReach * GrassReach)
			{
				continue;
			}
			// The same square always grows the same plants, so they do not jump about as the dragon moves.
			const FIntPoint Cell = Centre + FIntPoint(cx, cy);
			FRandomStream Rng(HashCombine(GetTypeHash(Cell.X * 73856093), GetTypeHash(Cell.Y * 19349663)));
			if (NearVillage(FVector2D((Cell.X + 0.5f) * GrassCell, (Cell.Y + 0.5f) * GrassCell), 6500.f))
			{
				continue;
			}
			for (int32 i = 0; i < GrassPerCell; ++i)
			{
				const float X = (Cell.X + Rng.FRand()) * GrassCell, Y = (Cell.Y + Rng.FRand()) * GrassCell;
				const float Pick = Rng.FRand(), Scale = Rng.FRand(), Yaw = Rng.FRandRange(0.f, 360.f);
				const float G = ADragonWorld::HeightAt(X, Y);
				if (G < 700.f || G > 52000.f || Flatness(X, Y, 150.f) < 0.82f || (Props && Props->IsScorched(FVector2D(X, Y))))
				{
					continue;
				}
				// Mostly grass; heather on the higher moors, ferns where the woods are, now and then flowers or a bush.
				const float Wood = FMath::PerlinNoise2D(FVector2D(X, Y) / 90000.f + FVector2D(5.3f, 9.1f));
				int32 K = 0;
				if (Pick > 0.95f) { K = 4; }
				else if (Pick > 0.88f) { K = 3; }
				else if (Pick > 0.78f && Wood > 0.15f) { K = 2; }
				else if (Pick > 0.62f && G > 9000.f) { K = 1; }
				K = FMath::Min(K, Grass.Num() - 1);
				const FKind& Kind = Grass[K];
				const float S = FMath::Lerp(Kind.MinScale, Kind.MaxScale, Scale);
				Out[K].Add(FTransform(FRotator(0.f, Yaw, 0.f), FVector(X, Y, G - 40.f), FVector(S)));
			}
		}
	}
	for (int32 i = 0; i < Grass.Num(); ++i)
	{
		Grass[i].Mesh->ClearInstances();
		Grass[i].Mesh->AddInstances(Out[i], false, true);
	}
}

void ADragonGround::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bStarted)
	{
		// On the first frame, once the villages are known.
		bStarted = true;
		for (TActorIterator<ADragonProps> It(GetWorld()); It; ++It) { Props = *It; }
		PlaceRocks();
		AddKind(Grass, TEXT("Foliage/Grass/FieldGrass/SM_FieldGrass_01.SM_FieldGrass_01"), 1.6f, 2.8f, 0.f, false, 11000, 15000);
		AddKind(Grass, TEXT("Foliage/Flowers/Heather/SM_Heather_Mesh_Clumps2.SM_Heather_Mesh_Clumps2"), 1.4f, 2.4f, 0.f, false, 11000, 15000);
		AddKind(Grass, TEXT("Foliage/Ferns/SM_Fern_01.SM_Fern_01"), 1.f, 1.7f, 0.f, false, 11000, 15000);
		AddKind(Grass, TEXT("Foliage/Flowers/Buttercup/SM_Buttercup_Patch_01.SM_Buttercup_Patch_01"), 1.f, 1.6f, 0.f, false, 11000, 15000);
		AddKind(Grass, TEXT("Foliage/BogMyrtleBush_02/BogMyrtleBush_02.BogMyrtleBush_02"), 1.3f, 2.2f, 0.f, true, 11000, 15000);
	}
	const APawn* Dragon = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Dragon || Grass.Num() == 0)
	{
		return;
	}
	const FVector At = Dragon->GetActorLocation();
	if (At.Z - FMath::Max(ADragonWorld::HeightAt(At.X, At.Y), 0.f) > GrassMaxAltitude)
	{
		if (bHasGrass)
		{
			bHasGrass = false;
			GrassCentre = FIntPoint(INT32_MAX, INT32_MAX);
			for (const FKind& K : Grass)
			{
				K.Mesh->ClearInstances();
			}
		}
		return;
	}
	const FIntPoint Centre(FMath::FloorToInt32(At.X / GrassCell), FMath::FloorToInt32(At.Y / GrassCell));
	const int32 Scorched = Props ? Props->NumScorches() : 0;
	if (Centre != GrassCentre || (Scorched != GrassScorchCount && FMath::FRand() < DeltaSeconds)) // regrow about once a second while the ground is burning
	{
		GrassCentre = Centre;
		GrassScorchCount = Scorched;
		bHasGrass = true;
		PlaceGrass(Centre);
	}
}
