#include "DragonProps.h"
#include "DragonPawn.h"
#include "DragonWorld.h"
#include "Components/AudioComponent.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Sound/SoundBase.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Math/RandomStream.h"
#include "Misc/CommandLine.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
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
	BurnAudio = CreateDefaultSubobject<UAudioComponent>(TEXT("BurnAudio"));
	BurnAudio->SetupAttachment(RootComponent);
	BurnAudio->bAutoActivate = false;
	BurnAudio->bIsUISound = true;
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

	// ---- real tree models, when the Open World Demo Collection is in the project ----
	UMaterialInterface* Hidden = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_Hidden.M_Hidden"), nullptr, LOAD_NoWarn | LOAD_Quiet);
	for (const TCHAR* Path : {
		TEXT("/Game/KiteDemo/Environments/Trees/HillTree_02/HillTree_02.HillTree_02"),
		TEXT("/Game/KiteDemo/Environments/Trees/HillTree_Tall_02/HillTree_Tall_02.HillTree_Tall_02"),
		TEXT("/Game/KiteDemo/Environments/Trees/ScotsPine_01/ScotsPine_01.ScotsPine_01"),
		TEXT("/Game/KiteDemo/Environments/Trees/ScotsPineTall_01/ScotsPineTall_01.ScotsPineTall_01") })
	{
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, Path, nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!Mesh || !Hidden)
		{
			continue;
		}
		FTreeKind K;
		K.Height = Mesh->GetBounds().BoxExtent.Z * 2.f;
		K.Alive = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
		K.Alive->SetupAttachment(RootComponent);
		K.Alive->RegisterComponent();
		K.Alive->SetStaticMesh(Mesh);
		K.Alive->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		// Trees fade out between 6 and 8 km.
		K.Alive->SetCullDistances(600000, 800000);

		// The burnt version: bark and branches turned to glowing char, everything leafy not drawn at all.
		K.Burnt = NewObject<UInstancedStaticMeshComponent>(this);
		K.Burnt->SetupAttachment(RootComponent);
		K.Burnt->RegisterComponent();
		K.Burnt->SetStaticMesh(Mesh);
		K.Burnt->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		K.Burnt->SetNumCustomDataFloats(3);
		K.Burnt->SetForcedLodModel(3); // a middle level of detail that still has its branches, at any distance
		const TArray<FStaticMaterial>& Slots = Mesh->GetStaticMaterials();
		for (int32 i = 0; i < Slots.Num(); ++i)
		{
			// The pack's own materials do not draw close up when instanced; Tools/setup_assets.py makes these in their place.
			if (Slots[i].MaterialInterface)
			{
				const FString Name = TEXT("M_") + Slots[i].MaterialInterface->GetName();
				if (UMaterialInterface* Plain = LoadObject<UMaterialInterface>(nullptr, *FString::Printf(TEXT("/Game/Materials/Trees/%s.%s"), *Name, *Name), nullptr, LOAD_NoWarn | LOAD_Quiet))
				{
					K.Alive->SetMaterial(i, Plain);
				}
			}
			if (Slots[i].MaterialSlotName.ToString().Contains(TEXT("Branches")))
			{
				UMaterialInstanceDynamic* Soot = UMaterialInstanceDynamic::Create(Base, this);
				Soot->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.03f, 0.024f, 0.02f));
				K.Burnt->SetMaterial(i, Soot);
			}
			else
			{
				K.Burnt->SetMaterial(i, Hidden);
			}
		}
		Kinds.Add(K);
	}

	if (USoundBase* Crackle = LoadObject<USoundBase>(nullptr, TEXT("/Game/Audio/burn_loop.burn_loop"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		BurnAudio->SetSound(Crackle);
		BurnAudio->SetVolumeMultiplier(0.01f);
		BurnAudio->Play();
	}

	LoadHouseKinds(Base);

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
					if (HouseKinds.Num() > 0)
					{
						AddRealHouse(FVector(P.X, P.Y, G), FMath::RadiansToDegrees(A) + Rng.FRandRange(-20.f, 20.f));
					}
					else
					{
						AddHouse(FVector(P.X, P.Y, G), FMath::RadiansToDegrees(A) + Rng.FRandRange(-20.f, 20.f), Rng.FRand());
					}
				}
			}
		}
	}

	VillageCentres = Villages;

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
				if (Kinds.Num() == 4)
				{
					// Pines keep to the higher ground and broadleaf trees to the lower, with some of each among the other.
					const bool bPine = Rng.FRand() < (G > 11000.f ? 0.8f : 0.25f);
					AddRealTree((bPine ? 2 : 0) + (Rng.FRand() < 0.5f ? 1 : 0), FVector(PX, PY, G), Rng.FRandRange(0.8f, 1.3f), Rng.FRandRange(0.f, 360.f));
				}
				else
				{
					AddTree(FVector(PX, PY, G), Rng.FRandRange(1100.f, 2100.f), Rng.FRandRange(0.f, 360.f), Rng.FRand());
				}
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

void ADragonProps::LoadHouseKinds(UMaterialInterface* SootBase)
{
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *(FPaths::ProjectContentDir() / TEXT("FaymereVillage/houses.txt"))))
	{
		return;
	}
	// One line per piece: P <mesh> <material or -> <x y z> <pitch yaw roll> <scale x y z>, under an H line for each kind of house.
	TMap<FString, int32> Known;
	TArray<FString> Lines;
	Text.ParseIntoArrayLines(Lines);
	for (const FString& Line : Lines)
	{
		TArray<FString> W;
		Line.ParseIntoArray(W, TEXT(" "));
		if (W.Num() >= 1 && W[0] == TEXT("H"))
		{
			HouseKinds.AddDefaulted();
			continue;
		}
		if (W.Num() != 12 || W[0] != TEXT("P") || HouseKinds.Num() == 0)
		{
			continue;
		}
		const FString Key = W[1] + TEXT("|") + W[2];
		int32 Part = INDEX_NONE;
		if (const int32* Found = Known.Find(Key))
		{
			Part = *Found;
		}
		else
		{
			UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *W[1], nullptr, LOAD_NoWarn | LOAD_Quiet);
			if (!Mesh)
			{
				continue;
			}
			FHousePart P;
			P.bStone = W[1].Contains(TEXT("SM_Wall"));
			P.bRoof = W[1].Contains(TEXT("400x400"));
			P.Alive = NewObject<UHierarchicalInstancedStaticMeshComponent>(this);
			P.Alive->SetupAttachment(RootComponent);
			P.Alive->RegisterComponent();
			P.Alive->SetStaticMesh(Mesh);
			P.Alive->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			P.Alive->SetCullDistances(500000, 700000);
			if (W[2] != TEXT("-"))
			{
				if (UMaterialInterface* Over = LoadObject<UMaterialInterface>(nullptr, *W[2], nullptr, LOAD_NoWarn | LOAD_Quiet))
				{
					P.Alive->SetMaterial(0, Over);
				}
			}
			if (!P.bStone && !P.bRoof)
			{
				P.Burnt = NewObject<UInstancedStaticMeshComponent>(this);
				P.Burnt->SetupAttachment(RootComponent);
				P.Burnt->RegisterComponent();
				P.Burnt->SetStaticMesh(Mesh);
				P.Burnt->SetCollisionEnabled(ECollisionEnabled::NoCollision);
				P.Burnt->SetNumCustomDataFloats(3);
				UMaterialInstanceDynamic* Soot = UMaterialInstanceDynamic::Create(SootBase, this);
				Soot->SetVectorParameterValue(TEXT("Color"), FLinearColor(0.035f, 0.028f, 0.022f));
				for (int32 i = 0; i < Mesh->GetStaticMaterials().Num(); ++i)
				{
					P.Burnt->SetMaterial(i, Soot);
				}
			}
			Part = HouseParts.Add(P);
			Known.Add(Key, Part);
		}
		FHousePiece Piece;
		Piece.Part = Part;
		Piece.Rel = FTransform(FRotator(FCString::Atof(*W[6]), FCString::Atof(*W[7]), FCString::Atof(*W[8])),
			FVector(FCString::Atof(*W[3]), FCString::Atof(*W[4]), FCString::Atof(*W[5])),
			FVector(FCString::Atof(*W[9]), FCString::Atof(*W[10]), FCString::Atof(*W[11])));
		HouseKinds.Last().Add(Piece);
	}
	HouseKinds.RemoveAll([](const TArray<FHousePiece>& K) { return K.Num() == 0; });
}

void ADragonProps::AddRealHouse(const FVector& Ground, float Yaw)
{
	FProp P;
	P.Pos = Ground;
	P.Height = 1300.f;
	P.Yaw = Yaw;
	P.bHouse = true;
	P.Kind = -2; // a house built from the village pack's pieces
	P.Low = Houses.AddDefaulted();
	// Set a little into the ground, so the stone base meets a slope without a gap.
	const FTransform Base(FRotator(0.f, Yaw, 0.f), Ground - FVector(0.f, 0.f, 150.f));
	for (const FHousePiece& Piece : HouseKinds[NumHouses % HouseKinds.Num()])
	{
		const FHousePart& Part = HouseParts[Piece.Part];
		const FTransform World = Piece.Rel * Base;
		const int32 Instance = Part.Alive->AddInstance(World, true);
		if (!Part.bStone)
		{
			Houses[P.Low].Timber.Add({ Piece.Part, Instance, World });
		}
	}
	Props.Add(P);
	++NumHouses;
}

void ADragonProps::AddRealTree(int32 Kind, const FVector& Ground, float Scale, float Yaw)
{
	FProp P;
	P.Pos = Ground;
	P.Kind = int8(Kind);
	P.Scale = Scale;
	P.Yaw = Yaw;
	P.Height = Kinds[Kind].Height * Scale;
	const FTransform T(FRotator(0.f, Yaw, 0.f), Ground - FVector(0.f, 0.f, 40.f), FVector(Scale));
	P.Low = Kinds[Kind].Alive->AddInstance(T, true);
	// Its burnt form is only added when it burns: thousands of hidden spares would still cost the GPU every frame.
	Props.Add(P);
	++NumTrees;
}

void ADragonProps::ShowBurn(FProp& P, float Char, float Glow)
{
	if (P.Kind == -2)
	{
		// A real house: once the fire has hold, its roof and some of its timber are gone and the rest stands charred.
		FHouseBuilt& H = Houses[P.Low];
		if (!P.bBare && Char > 0.45f)
		{
			P.bBare = true;
			for (const FHouseTimber& T : H.Timber)
			{
				const FHousePart& Part = HouseParts[T.Part];
				FTransform Gone = T.World;
				Gone.SetScale3D(FVector(0.001f));
				Part.Alive->UpdateInstanceTransform(T.Instance, Gone, true, true, true);
				// The upper floors lose more than the lower.
				const bool bStands = Part.Burnt && FMath::FRand() > (T.World.GetLocation().Z - P.Pos.Z > 700.f ? 0.5f : 0.15f);
				if (bStands)
				{
					H.Charred.Add(TPair<int32, int32>(T.Part, Part.Burnt->AddInstance(T.World, true)));
				}
			}
		}
		for (const TPair<int32, int32>& C : H.Charred)
		{
			HouseParts[C.Key].Burnt->SetCustomDataValue(C.Value, DataGlow, Glow * 0.4f, false);
			HouseParts[C.Key].Burnt->MarkRenderStateDirty();
		}
		return;
	}
	if (P.Kind >= 0)
	{
		// A real tree stands as it is while the fire takes hold, then its leaves are gone
		// and only the charred trunk and branches are left, glowing until they cool.
		const FTreeKind& K = Kinds[P.Kind];
		if (!P.bBare && Char > 0.45f)
		{
			P.bBare = true;
			const FRotator Rot(0.f, P.Yaw, 0.f);
			const FVector At = P.Pos - FVector(0.f, 0.f, 40.f);
			K.Alive->UpdateInstanceTransform(P.Low, FTransform(Rot, At, FVector(0.001f)), true, true, true);
			P.High = K.Burnt->AddInstance(FTransform(Rot, At, FVector(P.Scale)), true);
		}
		if (P.bBare)
		{
			K.Burnt->SetCustomDataValue(P.High, DataGlow, Glow * 0.35f, false); // embers in the bark, not a lantern
			K.Burnt->MarkRenderStateDirty();
		}
		return;
	}
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
	// Starting the game with -VillageTest stands the dragon in front of the first house, for a close look.
	static bool bVillageTest = FParse::Param(FCommandLine::Get(), TEXT("VillageTest"));
	if (bVillageTest && NumHouses > 0)
	{
		bVillageTest = false;
		Dragon->StandAt(FVector2D(Props[0].Pos.X - 3800.f, Props[0].Pos.Y));
	}

	// Starting the game with -TreeTest puts the dragon low in front of a tree in the middle of a wood, for a close look.
	static bool bTreeTest = FParse::Param(FCommandLine::Get(), TEXT("TreeTest"));
	if (bTreeTest && Props.Num() > NumHouses)
	{
		bTreeTest = false;
		// The thickest part of the woods: the cell holding the most trees.
		int32 Best = NumHouses, Most = 0;
		for (const TPair<FIntPoint, TArray<int32>>& Cell : Cells)
		{
			if (Cell.Value.Num() > Most && !Props[Cell.Value[0]].bHouse)
			{
				Most = Cell.Value.Num();
				Best = Cell.Value[0];
			}
		}
		const FVector Tree = Props[Best].Pos;
		Dragon->FaceFrom(Tree + FVector(-16000.f, 0.f, 4500.f), Tree + FVector(0.f, 0.f, 1000.f));
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
						if (IgniteWait <= 0.f)
						{
							IgniteWait = 0.25f;
							Dragon->PlayCue(TEXT("ignite"), 0.8f, FMath::FRandRange(0.85f, 1.15f));
						}
					}
				}
			}
		}
	}

	// ---- things on fire: glow, char, spread, throw flames ----
	IgniteWait -= DeltaSeconds;
	int32 NearFires = 0;
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

		NearFires += Glow > 0.1f && FVector::DistSquared(P.Pos, DragonPos) < FMath::Square(25000.f);
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
	BurnAudio->SetVolumeMultiplier(FMath::Max(FMath::FInterpTo(BurnAudio->VolumeMultiplier, FMath::Clamp(NearFires / 25.f, 0.f, 1.f), DeltaSeconds, 2.f), 0.01f));
	if (bChanged)
	{
		for (UInstancedStaticMeshComponent* C : { Trunks.Get(), Leaves.Get(), Walls.Get(), Roofs.Get() })
		{
			C->MarkRenderStateDirty();
		}
	}
}
