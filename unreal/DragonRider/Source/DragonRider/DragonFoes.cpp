#include "DragonFoes.h"
#include "DragonPawn.h"
#include "DragonProps.h"
#include "DragonWorld.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Camera/CameraActor.h"
#include "GameFramework/PlayerController.h"
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
	bReal = BuildRealKinds(Base);
	if (bReal)
	{
		TopZ = 1340.f;
	}

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
						if (bReal)
						{
							AddRealTower(Towers.Num() - 1);
						}
						else
						{
							Bases->AddInstance(FTransform(FRotator::ZeroRotator, T.Pos + FVector(0.f, 0.f, TowerHeight * 0.5f - 60.f), FVector(5.f, 5.f, TowerHeight / 100.f)), true);
							Tops->AddInstance(FTransform(FRotator::ZeroRotator, T.Pos + FVector(0.f, 0.f, TowerHeight), FVector(7.f, 7.f, 1.6f)), true);
							Bows->AddInstance(FTransform::Identity, true);
						}
						ShowTower(Towers.Num() - 1);
						break;
					}
				}
			}
		}
	}

	// The towers are added after the game has begun, so their batches' spatial trees are built now;
	// until a tree is built its batch has no bounds and is never drawn.
	for (FTowerMesh& M : TowerMeshes)
	{
		if (UHierarchicalInstancedStaticMeshComponent* H = Cast<UHierarchicalInstancedStaticMeshComponent>(M.Alive))
		{
			H->BuildTreeIfOutdated(false, true);
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

	// Starting the game with -TowerTest looks at the first tower through a fixed camera outside the village, for a close look.
	if (Towers.Num() > 0 && Props && Props->GetVillages().Num() > 0 && FParse::Param(FCommandLine::Get(), TEXT("TowerTest")))
	{
		FVector2D Nearest = Props->GetVillages()[0];
		for (const FVector2D& V : Props->GetVillages())
		{
			if (FVector2D::DistSquared(V, FVector2D(Towers[0].Pos)) < FVector2D::DistSquared(Nearest, FVector2D(Towers[0].Pos))) { Nearest = V; }
		}
		const FVector Out = FVector(FVector2D(Towers[0].Pos) - Nearest, 0.f).GetSafeNormal();
		FVector Eye = Towers[0].Pos + Out * 3600.f;
		Eye.Z = FMath::Max(Towers[0].Pos.Z + 900.f, ADragonWorld::HeightAt(Eye.X, Eye.Y) + 800.f);
		ACameraActor* Cam = GetWorld()->SpawnActor<ACameraActor>(Eye, (Towers[0].Pos + FVector(0.f, 0.f, 650.f) - Eye).Rotation());
		if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
		{
			PC->SetViewTarget(Cam);
		}
		// With -BurnTest too, the tower starts burnt out.
		if (FParse::Param(FCommandLine::Get(), TEXT("BurnTest")))
		{
			Towers[0].Health = 0.f;
			++TowersBurned;
			ShowTower(0);
			Props->ScorchAt(Towers[0].Pos, 2200.f);
			Props->AddSmoulder(Towers[0].Pos + FVector(0.f, 0.f, TopZ), 60.f, 1.2f);
		}
	}

	// Starting the game with -FoeTest puts the dragon in the air facing the first tower, for checking the fight.
	if (Towers.Num() > 0 && FParse::Param(FCommandLine::Get(), TEXT("FoeTest")))
	{
		if (ADragonPawn* Dragon = Cast<ADragonPawn>(UGameplayStatics::GetPlayerPawn(this, 0)))
		{
			FVector At = Towers[0].Pos + FVector(-14000.f, 0.f, 5500.f);
			At.Z = FMath::Max(At.Z, ADragonWorld::HeightAt(At.X, At.Y) + 3500.f); // not inside a hillside
			Dragon->FaceFrom(At, Towers[0].Pos + FVector(0.f, 0.f, TopZ));
		}
	}
}

void ADragonFoes::ShowTower(int32 Index)
{
	if (bReal)
	{
		ShowRealTower(Index);
		return;
	}
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
	static const bool bHoldFire = FParse::Param(FCommandLine::Get(), TEXT("TowerTest")); // towers only aim while being looked at
	const bool bPeace = Dragon->IsIntro() || Dragon->InCutscene() || bHoldFire; // nothing shoots during scenes
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
		const FVector Top = T.Pos + FVector(0.f, 0.f, TopZ);
		const FVector To = DragonPos - Top;
		const float Dist = To.Size();
		bool bChanged = false;

		if (bFire)
		{
			const FVector FromMouth = T.Pos + FVector(0.f, 0.f, TopZ * 0.6f) - Mouth;
			const float D = FromMouth.Size();
			if (D < FireReach && (FromMouth | FireDir) > D * 0.93f)
			{
				T.Health -= BurnPerSecond * DeltaSeconds;
				bChanged = true;
				// Flames lick round the top while it burns.
				FlameWait -= DeltaSeconds;
				if (FlameWait <= 0.f)
				{
					FlameWait = 0.05f;
					Dragon->FlamePuff(Top + FVector(FMath::FRandRange(-300.f, 300.f), FMath::FRandRange(-300.f, 300.f), FMath::FRandRange(-250.f, 100.f)),
						FVector(FMath::FRandRange(-150.f, 150.f), FMath::FRandRange(-150.f, 150.f), FMath::FRandRange(400.f, 900.f)), FMath::FRandRange(0.6f, 1.1f));
				}
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

bool ADragonFoes::BuildRealKinds(UMaterialInterface* SootBase)
{
	const TCHAR* Paths[] = {
		TEXT("/Game/FaymereVillage/Meshes/SM_Wall.SM_Wall"),
		TEXT("/Game/FaymereVillage/Meshes/SM_floor_all_0.SM_floor_all_0"),
		TEXT("/Game/FaymereVillage/Meshes/SM_Medieval_Modular_Wall_ueoqbdhdw_lod3_Var1.SM_Medieval_Modular_Wall_ueoqbdhdw_lod3_Var1"),
		TEXT("/Game/FaymereVillage/Meshes/SM_Wooden_Bollard_tlttae1fa_lod3.SM_Wooden_Bollard_tlttae1fa_lod3"),
		TEXT("/Game/FaymereVillage/Meshes/SM_Modular_Wooden_Ladder_xb4jcgtdw_lod3_Var1.SM_Modular_Wooden_Ladder_xb4jcgtdw_lod3_Var1") };
	enum { Stone, Floor, Parapet, Beam, Ladder };
	for (const TCHAR* Path : Paths)
	{
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, Path, nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!Mesh)
		{
			return false;
		}
		FTowerMesh M;
		const bool bBeams = TowerMeshes.Num() == Beam;
		M.Alive = bBeams ? NewObject<UInstancedStaticMeshComponent>(this) : NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
		M.Alive->SetupAttachment(RootComponent);
		M.Alive->RegisterComponent();
		M.Alive->SetStaticMesh(Mesh);
		M.Alive->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		M.Burnt = NewObject<UInstancedStaticMeshComponent>(this);
		M.Burnt->SetupAttachment(RootComponent);
		M.Burnt->RegisterComponent();
		M.Burnt->SetStaticMesh(Mesh);
		M.Burnt->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		M.Burnt->SetNumCustomDataFloats(3);
		UMaterialInstanceDynamic* Soot = UMaterialInstanceDynamic::Create(SootBase, this);
		Soot->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.03f, 0.025f, 0.02f));
		for (int32 i = 0; i < Mesh->GetStaticMaterials().Num(); ++i)
		{
			M.Burnt->SetMaterial(i, Soot);
		}
		TowerMeshes.Add(M);
	}

	auto Add = [this](int32 Mesh, const FRotator& Rot, const FVector& At, const FVector& Scale, bool bTurns, bool bTimber)
	{
		TowerPieces.Add({ Mesh, FTransform(Rot, At, Scale), bTurns, bTimber });
	};
	// The tower: six faces of stone wall, seven courses high, each course a little narrower than the one below.
	const float Course = 158.f;
	for (int32 Level = 0; Level < 7; ++Level)
	{
		const float Apothem = 285.f - Level * 4.f;
		for (int32 k = 0; k < 6; ++k)
		{
			const float A = FMath::DegreesToRadians(60.f * k);
			Add(Stone, FRotator(0.f, 60.f * k + 90.f, 0.f), FVector(Apothem * FMath::Cos(A), Apothem * FMath::Sin(A), 82.f + Level * Course), FVector(1.f, 1.f, 1.f), false, false);
		}
	}
	const float Deck = 82.f + 6 * Course + 82.f;
	// A timber deck on top, ringed by a low parapet.
	Add(Floor, FRotator::ZeroRotator, FVector(0.f, 0.f, Deck), FVector(0.98f, 0.33f, 1.5f), false, true);
	for (int32 k = 0; k < 6; ++k)
	{
		// Battlements: a low course of the same stone round the edge.
		const float A = FMath::DegreesToRadians(60.f * k);
		Add(Stone, FRotator(0.f, 60.f * k + 90.f, 0.f), FVector(300.f * FMath::Cos(A), 300.f * FMath::Sin(A), Deck + 55.f), FVector(1.07f, 0.8f, 0.65f), false, false);
	}
	// A ladder up the back.
	for (int32 Rung = 0; Rung < 8; ++Rung)
	{
		Add(Ladder, FRotator(0.f, 90.f, 0.f), FVector(-310.f, 0.f, Rung * 140.f), FVector(1.f), false, true);
	}
	// The ballista, built of beams round a pivot post. A beam stands along its own Z; pitched down by 90 it lies along X.
	const FVector Pivot(0.f, 0.f, Deck + 15.f);
	Add(Beam, FRotator::ZeroRotator, Pivot, FVector(3.6f, 3.6f, 2.1f), true, true);                                    // pivot post
	Add(Beam, FRotator(-90.f, 0.f, 0.f), Pivot + FVector(-260.f, 0.f, 175.f), FVector(3.f, 3.f, 6.8f), true, true);     // stock
	Add(Beam, FRotator(-90.f, 100.f, 0.f), Pivot + FVector(250.f, 0.f, 190.f), FVector(2.2f, 2.2f, 4.8f), true, true);  // bow arms
	Add(Beam, FRotator(-90.f, -100.f, 0.f), Pivot + FVector(250.f, 0.f, 190.f), FVector(2.2f, 2.2f, 4.8f), true, true);
	Add(Beam, FRotator(-90.f, 0.f, 0.f), Pivot + FVector(-200.f, 0.f, 215.f), FVector(0.9f, 0.9f, 7.f), true, true);    // the bolt
	return true;
}

void ADragonFoes::AddRealTower(int32 Index)
{
	const FTower& T = Towers[Index];
	TArray<int32>& Inst = TowerInstances.AddDefaulted_GetRef();
	const FTransform Base(FRotator(0.f, FMath::Fmod(T.Pos.X * 0.37f, 360.f), 0.f), T.Pos - FVector(0.f, 0.f, 120.f));
	for (const FTowerPiece& P : TowerPieces)
	{
		Inst.Add(TowerMeshes[P.Mesh].Alive->AddInstance(P.Rel * Base, true));
	}
}

void ADragonFoes::ShowRealTower(int32 Index)
{
	const FTower& T = Towers[Index];
	TArray<int32>& Inst = TowerInstances[Index];
	const FVector Ground = T.Pos - FVector(0.f, 0.f, 120.f);
	if (T.Health > 0.f)
	{
		// Turn the ballista to its aim.
		const FTransform Turn(FRotator(0.f, T.Aim, 0.f), Ground);
		for (int32 i = 0; i < TowerPieces.Num(); ++i)
		{
			if (TowerPieces[i].bTurns)
			{
				TowerMeshes[TowerPieces[i].Mesh].Alive->UpdateInstanceTransform(Inst[i], TowerPieces[i].Rel * Turn, true, true, true);
			}
		}
		return;
	}
	if (Inst.Num() == 0 || Inst[0] < 0)
	{
		return; // already burnt
	}
	// Burnt out: every timber piece is swapped for a charred one, a few fall away, and the ballista lies tipped over.
	const FTransform Base(FRotator(0.f, FMath::Fmod(T.Pos.X * 0.37f, 360.f), 0.f), Ground);
	const FTransform Fallen(FRotator(28.f, T.Aim, 8.f), Ground - FVector(0.f, 0.f, 60.f));
	for (int32 i = 0; i < TowerPieces.Num(); ++i)
	{
		const FTowerPiece& P = TowerPieces[i];
		if (!P.bTimber)
		{
			continue;
		}
		FTowerMesh& M = TowerMeshes[P.Mesh];
		const FTransform Was = P.Rel * (P.bTurns ? FTransform(FRotator(0.f, T.Aim, 0.f), Ground) : Base);
		FTransform Gone = Was;
		Gone.SetScale3D(FVector(0.001f));
		M.Alive->UpdateInstanceTransform(Inst[i], Gone, true, true, true);
		if (FMath::FRand() < 0.8f)
		{
			M.Burnt->AddInstance(P.bTurns ? P.Rel * Fallen : Was, true);
		}
	}
	Inst[0] = -1;
}
