#include "DragonProps.h"
#include "DragonPawn.h"
#include "DragonWorld.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Math/RandomStream.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace
{
	const float CellSize = 2000.f;
	const float SpreadRange = 1500.f;   // how far a fire can jump to a neighbour
	const float SpreadAfter = 2.0f;     // seconds alight before it tries
	const float BurnTime = 10.f;        // seconds until a thing is burnt out
	const float FireReach = 9500.f;     // how far the dragon's breath sets things alight
	const int32 MaxTrees = 30000;

	/** Per-instance values read by the M_Prop material: how charred, how brightly glowing, and a shade. */
	enum { DataChar = 0, DataGlow = 1, DataShade = 2 };

	bool IsFlat(float X, float Y, float Reach, float MaxRise)
	{
		const float H = ADragonWorld::HeightAt(X, Y);
		return FMath::Abs(ADragonWorld::HeightAt(X + Reach, Y) - H) < MaxRise
			&& FMath::Abs(ADragonWorld::HeightAt(X - Reach, Y) - H) < MaxRise
			&& FMath::Abs(ADragonWorld::HeightAt(X, Y + Reach) - H) < MaxRise
			&& FMath::Abs(ADragonWorld::HeightAt(X, Y - Reach) - H) < MaxRise;
	}
}

ADragonProps::ADragonProps()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	auto Make = [this](const TCHAR* Name)
	{
		UInstancedStaticMeshComponent* C = CreateDefaultSubobject<UInstancedStaticMeshComponent>(Name);
		C->SetupAttachment(RootComponent);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		return C;
	};
	Trunks = Make(TEXT("Trunks"));
	Leaves = Make(TEXT("Leaves"));
	Walls = Make(TEXT("Walls"));
	Roofs = Make(TEXT("Roofs"));
}

FIntPoint ADragonProps::CellOf(const FVector& P)
{
	return FIntPoint(FMath::FloorToInt32(P.X / CellSize), FMath::FloorToInt32(P.Y / CellSize));
}

void ADragonProps::BeginPlay()
{
	Super::BeginPlay();

	UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_Prop.M_Prop"), nullptr, LOAD_NoWarn | LOAD_Quiet);
	if (!Base)
	{
		Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
	}
	auto Setup = [this, Base](UInstancedStaticMeshComponent* C, const TCHAR* MeshPath, const FLinearColor& Colour)
	{
		C->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, MeshPath));
		UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(Base, this);
		M->SetVectorParameterValue(TEXT("Color"), Colour);
		C->SetMaterial(0, M);
		C->SetNumCustomDataFloats(3);
	};
	Setup(Trunks, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"), FLinearColor(0.10f, 0.06f, 0.035f));
	Setup(Leaves, TEXT("/Engine/BasicShapes/Cone.Cone"), FLinearColor(0.035f, 0.13f, 0.03f));
	Setup(Walls, TEXT("/Engine/BasicShapes/Cube.Cube"), FLinearColor(0.50f, 0.42f, 0.30f));
	Setup(Roofs, TEXT("/Engine/BasicShapes/Cube.Cube"), FLinearColor(0.30f, 0.09f, 0.05f));

	FRandomStream Rng(20261113);
	const float R = ADragonWorld::PlayRadius;

	// ---- villages: on flat ground not far above the sea, well apart from each other ----
	TArray<FVector2D> Villages;
	for (int32 Try = 0; Try < 6000 && Villages.Num() < 12; ++Try)
	{
		const FVector2D C(Rng.FRandRange(-0.8f * R, 0.8f * R), Rng.FRandRange(-0.8f * R, 0.8f * R));
		const float H = ADragonWorld::HeightAt(C.X, C.Y);
		if (H < 1500.f || H > 14000.f || !IsFlat(C.X, C.Y, 5000.f, 1500.f))
		{
			continue;
		}
		bool bFar = true;
		for (const FVector2D& V : Villages)
		{
			bFar &= FVector2D::Distance(V, C) > 70000.f;
		}
		if (!bFar)
		{
			continue;
		}
		Villages.Add(C);
		// Houses in rings around an open middle, each facing roughly inward.
		for (int32 Ring = 1; Ring <= 3; ++Ring)
		{
			const int32 Count = 5 * Ring;
			for (int32 i = 0; i < Count; ++i)
			{
				const float A = 2.f * PI * (i + Rng.FRandRange(-0.25f, 0.25f)) / Count + Ring;
				const float D = 2000.f * Ring + Rng.FRandRange(-350.f, 350.f);
				const FVector2D P = C + FVector2D(FMath::Cos(A), FMath::Sin(A)) * D;
				const float G = ADragonWorld::HeightAt(P.X, P.Y);
				if (G > 800.f && IsFlat(P.X, P.Y, 500.f, 260.f))
				{
					AddHouse(FVector(P.X, P.Y, G), FMath::RadiansToDegrees(A) + Rng.FRandRange(-20.f, 20.f), Rng.FRand());
				}
			}
		}
	}

	// ---- forests: patches of pines on the green slopes, kept clear of the villages ----
	const float Step = 1500.f;
	for (float Y = -0.9f * R; Y < 0.9f * R && NumTrees < MaxTrees; Y += Step)
	{
		for (float X = -0.9f * R; X < 0.9f * R && NumTrees < MaxTrees; X += Step)
		{
			// Broad noise decides where the woods are; a second, finer one breaks up their edges.
			const float Wood = FMath::PerlinNoise2D(FVector2D(X, Y) / 90000.f + FVector2D(5.3f, 9.1f))
				+ 0.35f * FMath::PerlinNoise2D(FVector2D(X, Y) / 14000.f);
			if (Wood < 0.25f || Rng.FRand() > 0.4f)
			{
				continue;
			}
			const float PX = X + Rng.FRandRange(-0.45f, 0.45f) * Step, PY = Y + Rng.FRandRange(-0.45f, 0.45f) * Step;
			const float G = ADragonWorld::HeightAt(PX, PY);
			if (G < 1500.f || G > 42000.f || !IsFlat(PX, PY, 400.f, 330.f))
			{
				continue;
			}
			bool bClear = true;
			for (const FVector2D& V : Villages)
			{
				bClear &= FVector2D::Distance(V, FVector2D(PX, PY)) > 8500.f;
			}
			if (bClear)
			{
				AddTree(FVector(PX, PY, G), Rng.FRandRange(1100.f, 2100.f), Rng.FRandRange(0.f, 360.f), Rng.FRand());
			}
		}
	}

	for (int32 i = 0; i < Props.Num(); ++i)
	{
		Cells.FindOrAdd(CellOf(Props[i].Pos)).Add(i);
	}
	// Starting the game with -BurnTest sets the nearest woods and houses alight at once, for checking the effect.
	if (FParse::Param(FCommandLine::Get(), TEXT("BurnTest")))
	{
		for (int32 i = 0; i < Props.Num(); ++i)
		{
			if (FVector2D(Props[i].Pos.X, Props[i].Pos.Y).Size() < 350000.f && (i % 3 == 0 || Props[i].bHouse))
			{
				Ignite(i);
			}
		}
	}
	for (UInstancedStaticMeshComponent* C : { Trunks.Get(), Leaves.Get(), Walls.Get(), Roofs.Get() })
	{
		C->MarkRenderStateDirty();
	}
}

FTransform ADragonProps::HighTransform(const FProp& P, float Shrink) const
{
	if (P.bHouse)
	{
		// A cube turned on its edge makes a pitched roof; burnt out, it sinks into the walls.
		const FRotator Rot(0.f, P.Yaw, 45.f);
		return FTransform(Rot, P.Pos + FVector(0.f, 0.f, 420.f - 260.f * (1.f - Shrink)), FVector(9.4f, 4.6f, 4.6f) * FVector(1.f, Shrink, Shrink));
	}
	// The basic cone is 1 m wide and 1 m tall, centred on its middle.
	const float Tall = P.Height * 0.78f * Shrink, Wide = P.Height * 0.42f * FMath::Lerp(0.35f, 1.f, Shrink);
	return FTransform(FRotator(0.f, P.Yaw, 0.f), P.Pos + FVector(0.f, 0.f, P.Height * 0.22f + Tall * 0.5f), FVector(Wide / 100.f, Wide / 100.f, Tall / 100.f));
}

void ADragonProps::AddTree(const FVector& Ground, float Height, float Yaw, float Shade)
{
	FProp P;
	P.Pos = Ground;
	P.Height = Height;
	P.Yaw = Yaw;
	const float TrunkTall = Height * 0.3f;
	P.Low = Trunks->AddInstance(FTransform(FRotator::ZeroRotator, Ground + FVector(0.f, 0.f, TrunkTall * 0.5f - 30.f), FVector(Height * 0.0007f, Height * 0.0007f, TrunkTall / 100.f)), true);
	P.High = Leaves->AddInstance(HighTransform(P, 1.f), true);
	Trunks->SetCustomDataValue(P.Low, DataShade, Shade, false);
	Leaves->SetCustomDataValue(P.High, DataShade, Shade, false);
	Props.Add(P);
	++NumTrees;
}

void ADragonProps::AddHouse(const FVector& Ground, float Yaw, float Shade)
{
	FProp P;
	P.Pos = Ground;
	P.Height = 700.f;
	P.Yaw = Yaw;
	P.bHouse = true;
	P.Low = Walls->AddInstance(FTransform(FRotator(0.f, Yaw, 0.f), Ground + FVector(0.f, 0.f, 170.f), FVector(8.6f, 5.6f, 4.4f)), true);
	P.High = Roofs->AddInstance(HighTransform(P, 1.f), true);
	Walls->SetCustomDataValue(P.Low, DataShade, Shade, false);
	Roofs->SetCustomDataValue(P.High, DataShade, Shade, false);
	Props.Add(P);
	++NumHouses;
}

void ADragonProps::Ignite(int32 Index)
{
	FProp& P = Props[Index];
	if (P.Burn > 0.f)
	{
		return;
	}
	P.Burn = 0.001f;
	Burning.Add(Index);
	(P.bHouse ? HousesBurned : TreesBurned)++;
}

void ADragonProps::ShowBurn(const FProp& P, float Char, float Glow)
{
	UInstancedStaticMeshComponent* LowComp = P.bHouse ? Walls : Trunks;
	UInstancedStaticMeshComponent* HighComp = P.bHouse ? Roofs : Leaves;
	LowComp->SetCustomDataValue(P.Low, DataChar, Char, false);
	LowComp->SetCustomDataValue(P.Low, DataGlow, Glow * 0.6f, false);
	HighComp->SetCustomDataValue(P.High, DataChar, Char, false);
	HighComp->SetCustomDataValue(P.High, DataGlow, Glow, false);
	// Leaves burn away to a bare spike and roofs fall in as the thing chars.
	HighComp->UpdateInstanceTransform(P.High, HighTransform(P, 1.f - 0.55f * Char), true, false, true);
}

void ADragonProps::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	ADragonPawn* Dragon = Cast<ADragonPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!Dragon)
	{
		return;
	}
	const FVector DragonPos = Dragon->GetActorLocation();

	// ---- the breath lights whatever lies in its cone ----
	if (Dragon->IsBreathingFire())
	{
		const FVector Mouth = Dragon->GetMouthLocation(), Dir = Dragon->GetFireDirection();
		const FIntPoint Mid = CellOf(Mouth + Dir * FireReach * 0.5f);
		const int32 Span = FMath::CeilToInt32(FireReach * 0.6f / CellSize);
		for (int32 cy = -Span; cy <= Span; ++cy)
		{
			for (int32 cx = -Span; cx <= Span; ++cx)
			{
				const TArray<int32>* Cell = Cells.Find(Mid + FIntPoint(cx, cy));
				if (!Cell)
				{
					continue;
				}
				for (int32 Index : *Cell)
				{
					const FProp& P = Props[Index];
					if (P.Burn > 0.f)
					{
						continue;
					}
					const FVector To = P.Pos + FVector(0.f, 0.f, P.Height * 0.5f) - Mouth;
					const float Dist = To.Size();
					if (Dist < FireReach && (To | Dir) > Dist * 0.93f) // within about 21 degrees
					{
						Ignite(Index);
					}
				}
			}
		}
	}

	// ---- things on fire: glow, char, spread, throw flames ----
	bool bChanged = false;
	for (int32 b = Burning.Num() - 1; b >= 0; --b)
	{
		const int32 Index = Burning[b];
		FProp& P = Props[Index];
		P.Burn += DeltaSeconds;
		const float T = FMath::Clamp(P.Burn / BurnTime, 0.f, 1.f);
		// Flares up fast, burns steadily, then dies down to embers.
		const float Glow = FMath::Min(P.Burn * 2.f, 1.f) * FMath::Lerp(1.f, 0.f, FMath::SmoothStep(0.65f, 1.f, T));
		ShowBurn(P, FMath::SmoothStep(0.05f, 0.8f, T), Glow);
		bChanged = true;

		if (!P.bSpread && P.Burn > SpreadAfter)
		{
			P.bSpread = true;
			const FIntPoint Mid = CellOf(P.Pos);
			for (int32 cy = -1; cy <= 1; ++cy)
			{
				for (int32 cx = -1; cx <= 1; ++cx)
				{
					if (const TArray<int32>* Cell = Cells.Find(Mid + FIntPoint(cx, cy)))
					{
						for (int32 Other : *Cell)
						{
							// Houses catch more readily than trees, so a village goes up together.
							const float Chance = Props[Other].bHouse ? 0.9f : 0.6f;
							if (Props[Other].Burn <= 0.f && FVector::DistSquared(Props[Other].Pos, P.Pos) < SpreadRange * SpreadRange * (Props[Other].bHouse ? 4.f : 1.f) && FMath::FRand() < Chance)
							{
								Ignite(Other);
							}
						}
					}
				}
			}
		}

		// Flames are only worth drawing near the dragon.
		if (Glow > 0.1f && FVector::DistSquared(P.Pos, DragonPos) < FMath::Square(60000.f) && FMath::FRand() < DeltaSeconds * 5.f * Glow)
		{
			const FVector At = P.Pos + FVector(FMath::FRandRange(-250.f, 250.f), FMath::FRandRange(-250.f, 250.f), P.Height * FMath::FRandRange(0.3f, 0.9f));
			Dragon->FlamePuff(At, FVector(FMath::FRandRange(-200.f, 200.f), FMath::FRandRange(-200.f, 200.f), FMath::FRandRange(500.f, 1100.f)), FMath::FRandRange(0.7f, 1.3f));
		}

		if (P.Burn >= BurnTime)
		{
			P.bDone = true;
			ShowBurn(P, 1.f, 0.f);
			Burning.RemoveAtSwap(b);
		}
	}
	if (bChanged)
	{
		for (UInstancedStaticMeshComponent* C : { Trunks.Get(), Leaves.Get(), Walls.Get(), Roofs.Get() })
		{
			C->MarkRenderStateDirty();
		}
	}
}
