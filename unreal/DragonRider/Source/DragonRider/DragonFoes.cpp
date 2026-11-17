#include "DragonFoes.h"
#include "DragonPawn.h"
#include "DragonProps.h"
#include "DragonWorld.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Math/RandomStream.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace
{
	const float TowerHeight = 1500.f;
	const float SightRange = 30000.f;   // how far a tower sees the dragon
	const float BoltSpeed = 10000.f;
	const float ReloadTime = 2.4f;
	const float BoltDamage = 12.f;
	const float HitRadius = 420.f;
	const float FireReach = 9500.f;     // matches the breath's reach on trees and houses
	const float BurnPerSecond = 55.f;

	enum { DataChar = 0, DataGlow = 1, DataShade = 2 }; // same per-instance values as the trees use
}

ADragonFoes::ADragonFoes()
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
	Bases = Make(TEXT("Bases"));
	Tops = Make(TEXT("Tops"));
	Bows = Make(TEXT("Bows"));
	BoltMeshes = Make(TEXT("Bolts"));
	BoltMeshes->SetCastShadow(false);
}

void ADragonFoes::Build()
{
	bBuilt = true;
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
	Setup(Bases, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"), FLinearColor(0.22f, 0.21f, 0.20f));
	Setup(Tops, TEXT("/Engine/BasicShapes/Cube.Cube"), FLinearColor(0.16f, 0.10f, 0.06f));
	Setup(Bows, TEXT("/Engine/BasicShapes/Cube.Cube"), FLinearColor(0.05f, 0.04f, 0.04f));
	Setup(BoltMeshes, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"), FLinearColor(0.9f, 0.5f, 0.15f));

	// Two towers on opposite sides of each village, a little way out from the houses.
	for (TActorIterator<ADragonProps> It(GetWorld()); It; ++It) { Props = *It; }
	FRandomStream Rng(771);
	if (Props)
	{
		for (const FVector2D& Village : Props->GetVillages())
		{
			const float Start = Rng.FRandRange(0.f, 2.f * PI);
			for (int32 k = 0; k < 2; ++k)
			{
				// Try a few spots round the village for one that is dry land.
				for (int32 Try = 0; Try < 8; ++Try)
				{
					const float A = Start + k * PI + Try * 0.35f;
					const FVector2D P = Village + FVector2D(FMath::Cos(A), FMath::Sin(A)) * 7600.f;
					const float G = ADragonWorld::HeightAt(P.X, P.Y);
					if (G > 500.f)
					{
						FTower T;
						T.Pos = FVector(P.X, P.Y, G);
						T.Reload = Rng.FRandRange(0.f, ReloadTime);
						Towers.Add(T);
						Bases->AddInstance(FTransform(FRotator::ZeroRotator, T.Pos + FVector(0.f, 0.f, TowerHeight * 0.5f - 60.f), FVector(5.f, 5.f, TowerHeight / 100.f)), true);
						Tops->AddInstance(FTransform(FRotator::ZeroRotator, T.Pos + FVector(0.f, 0.f, TowerHeight), FVector(7.f, 7.f, 1.6f)), true);
						Bows->AddInstance(FTransform::Identity, true);
						ShowTower(Towers.Num() - 1);
						break;
					}
				}
			}
		}
	}

	Bolts.SetNum(64);
	for (int32 i = 0; i < Bolts.Num(); ++i)
	{
		const int32 Index = BoltMeshes->AddInstance(FTransform(FRotator::ZeroRotator, FVector::ZeroVector, FVector(0.001f)), true);
		BoltMeshes->SetCustomDataValue(Index, DataGlow, 1.f, false); // bolts glow so they can be seen coming
	}
	for (UInstancedStaticMeshComponent* C : { Bases.Get(), Tops.Get(), Bows.Get(), BoltMeshes.Get() })
	{
		C->MarkRenderStateDirty();
	}

	// Starting the game with -FoeTest puts the dragon in the air facing the first tower, for checking the fight.
	if (Towers.Num() > 0 && FParse::Param(FCommandLine::Get(), TEXT("FoeTest")))
	{
		if (ADragonPawn* Dragon = Cast<ADragonPawn>(UGameplayStatics::GetPlayerPawn(this, 0)))
		{
			FVector At = Towers[0].Pos + FVector(-14000.f, 0.f, 5500.f);
			At.Z = FMath::Max(At.Z, ADragonWorld::HeightAt(At.X, At.Y) + 3500.f); // not inside a hillside
			Dragon->FaceFrom(At, Towers[0].Pos + FVector(0.f, 0.f, TowerHeight));
		}
	}
}

void ADragonFoes::ShowTower(int32 Index)
{
	const FTower& T = Towers[Index];
	const float Char = 1.f - FMath::Clamp(T.Health / 100.f, 0.f, 1.f);
	const float Glow = T.Health <= 0.f ? 0.f : FMath::Min(Char * 2.5f, 1.f);
	for (UInstancedStaticMeshComponent* C : { Bases.Get(), Tops.Get(), Bows.Get() })
	{
		C->SetCustomDataValue(Index, DataChar, Char, false);
		C->SetCustomDataValue(Index, DataGlow, Glow * 0.7f, false);
	}
	// The bow is a beam across the top that turns to follow the dragon; burnt out, it lies fallen.
	const FRotator Rot(T.Health <= 0.f ? 25.f : 0.f, T.Aim, 0.f);
	Bows->UpdateInstanceTransform(Index, FTransform(Rot, T.Pos + FVector(0.f, 0.f, TowerHeight + 150.f), FVector(0.7f, 9.f, 0.7f)), true, false, true);
}

void ADragonFoes::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bBuilt)
	{
		Build(); // on the first frame, once the villages exist
	}
	ADragonPawn* Dragon = Cast<ADragonPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!Dragon || DeltaSeconds <= 0.f)
	{
		return;
	}
	const FVector DragonPos = Dragon->GetActorLocation();
	const FVector DragonVel = (DragonPos - LastDragonPos) / DeltaSeconds;
	LastDragonPos = DragonPos;
	const bool bPeace = Dragon->IsIntro() || Dragon->InCutscene(); // nothing shoots during scenes
	const bool bFire = Dragon->IsBreathingFire();
	const FVector Mouth = Dragon->GetMouthLocation(), FireDir = Dragon->GetFireDirection();

	// ---- towers: burn under the breath, turn, and shoot ahead of the dragon ----
	for (int32 i = 0; i < Towers.Num(); ++i)
	{
		FTower& T = Towers[i];
		if (T.Health <= 0.f)
		{
			continue;
		}
		const FVector Top = T.Pos + FVector(0.f, 0.f, TowerHeight + 150.f);
		const FVector To = DragonPos - Top;
		const float Dist = To.Size();
		bool bChanged = false;

		if (bFire)
		{
			const FVector FromMouth = T.Pos + FVector(0.f, 0.f, TowerHeight * 0.6f) - Mouth;
			const float D = FromMouth.Size();
			if (D < FireReach && (FromMouth | FireDir) > D * 0.93f)
			{
				T.Health -= BurnPerSecond * DeltaSeconds;
				bChanged = true;
				if (T.Health <= 0.f)
				{
					++TowersBurned;
					if (Props)
					{
						Props->ScorchAt(T.Pos, 2200.f);
						Props->AddSmoulder(Top, 60.f, 1.2f);
					}
					Dragon->FireBurst(Top);
					Dragon->PlayCue(TEXT("ignite"), 1.f, 0.7f);
				}
			}
		}

		if (T.Health > 0.f && Dist < SightRange && !bPeace)
		{
			T.Aim = To.Rotation().Yaw;
			bChanged = true;
			T.Reload -= DeltaSeconds;
			if (T.Reload <= 0.f)
			{
				T.Reload = ReloadTime * FMath::FRandRange(0.85f, 1.25f);
				// Aim where the dragon will be, but not perfectly, so a turn throws it off.
				const FVector Target = DragonPos + DragonVel * (Dist / BoltSpeed) * 0.85f + FMath::VRand() * 250.f;
				for (FBolt& B : Bolts)
				{
					if (B.Life <= 0.f)
					{
						B.Pos = Top;
						B.Vel = (Target - Top).GetSafeNormal() * BoltSpeed;
						B.Life = 5.f;
						break;
					}
				}
				Dragon->PlayCue(TEXT("thud"), FMath::Clamp(1.f - Dist / SightRange, 0.15f, 0.7f), 1.9f);
			}
		}
		if (bChanged)
		{
			ShowTower(i);
		}
	}

	// ---- bolts in flight ----
	for (int32 i = 0; i < Bolts.Num(); ++i)
	{
		FBolt& B = Bolts[i];
		if (B.Life <= 0.f)
		{
			continue;
		}
		B.Life -= DeltaSeconds;
		const FVector Next = B.Pos + B.Vel * DeltaSeconds;
		// Closest the bolt came to the dragon during this step.
		const float Closest = FMath::PointDistToSegment(DragonPos, B.Pos, Next);
		B.Pos = Next;
		float Scale = 1.f;
		if (Closest < HitRadius && !bPeace)
		{
			Dragon->Hurt(BoltDamage);
			B.Life = 0.f;
		}
		if (B.Life <= 0.f || B.Pos.Z < ADragonWorld::HeightAt(B.Pos.X, B.Pos.Y))
		{
			B.Life = 0.f;
			Scale = 0.001f;
		}
		// The basic cylinder stands along Z, so it is pitched over to lie along its flight.
		const FRotator Rot = (B.Vel.Rotation().Quaternion() * FRotator(-90.f, 0.f, 0.f).Quaternion()).Rotator();
		BoltMeshes->UpdateInstanceTransform(i, FTransform(Rot, B.Pos, FVector(0.5f, 0.5f, 5.f) * Scale), true, false, true);
	}
	for (UInstancedStaticMeshComponent* C : { Bases.Get(), Tops.Get(), Bows.Get(), BoltMeshes.Get() })
	{
		C->MarkRenderStateDirty();
	}
}
