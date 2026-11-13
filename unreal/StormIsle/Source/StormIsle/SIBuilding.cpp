#include "SIBuilding.h"
#include "SIResources.h"
#include "SIUtil.h"
#include "SIWorld.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EngineUtils.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	enum { FloorC, WallC, RoofC, StoneC, LogC, GlowC, NumParts };
	const float C = Isle::Cell;
	const float Reach = 1000.f;           // how far from the player a piece may be placed
	const float FloorDepth = 120.f;       // floors reach down into the ground to cover slopes
	const float RoofThick = 25.f;

	FIntPoint CellOf(const FVector& P)
	{
		return FIntPoint(FMath::FloorToInt32(P.X / C), FMath::FloorToInt32(P.Y / C));
	}

	FVector2D CentreOf(const FIntPoint& Cell)
	{
		return FVector2D((Cell.X + 0.5f) * C, (Cell.Y + 0.5f) * C);
	}
}

ASIBuilding::ASIBuilding()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void ASIBuilding::BeginPlay()
{
	Super::BeginPlay();
	struct FLook { const TCHAR* Shape; const TCHAR* Mat; FLinearColor Colour; };
	const FLook Looks[NumParts] = {
		{ TEXT("Cube"),     TEXT("M_Prop"), FLinearColor(0.30f, 0.20f, 0.11f) },
		{ TEXT("Cube"),     TEXT("M_Prop"), FLinearColor(0.36f, 0.25f, 0.14f) },
		{ TEXT("Cube"),     TEXT("M_Prop"), FLinearColor(0.20f, 0.16f, 0.08f) },
		{ TEXT("Sphere"),   TEXT("M_Prop"), FLinearColor(0.22f, 0.21f, 0.19f) },
		{ TEXT("Cylinder"), TEXT("M_Prop"), FLinearColor(0.12f, 0.07f, 0.04f) },
		{ TEXT("Cone"),     TEXT("M_Glow"), FLinearColor(0.5f, 0.2f, 1.0f) },
	};
	for (int32 i = 0; i < NumParts; ++i)
	{
		UInstancedStaticMeshComponent* P = NewObject<UInstancedStaticMeshComponent>(this);
		P->SetupAttachment(RootComponent);
		P->RegisterComponent();
		P->SetStaticMesh(Isle::Mesh(Looks[i].Shape));
		P->SetMaterial(0, Isle::Tinted(Looks[i].Mat, Looks[i].Colour, this));
		P->SetNumCustomDataFloats(2);
		if (i <= RoofC || i == StoneC)
		{
			P->SetCollisionProfileName(TEXT("BlockAll"));
		}
		else
		{
			P->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		}
		Parts.Add(P);
	}

	Ghost = NewObject<UStaticMeshComponent>(this);
	Ghost->SetupAttachment(RootComponent);
	Ghost->RegisterComponent();
	Ghost->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Ghost->SetCastShadow(false);
	GhostMat = Isle::Tinted(TEXT("M_Ghost"), FLinearColor(0.2f, 1.f, 0.4f), this);
	Ghost->SetMaterial(0, GhostMat);
	Ghost->SetVisibility(false);

	TActorIterator<ASIResources> It(GetWorld());
	Resources = It ? *It : nullptr;
}

float ASIBuilding::FloorTop(const FIntPoint& Cell) const
{
	const float* F = Floors.Find(Cell);
	return F ? *F : -1e9f;
}

float ASIBuilding::GroundTop(const FVector2D& Centre, float Half) const
{
	float H = ASIWorld::HeightAt(Centre.X, Centre.Y);
	for (int32 i = 0; i < 4; ++i)
	{
		const float X = Centre.X + (i & 1 ? Half : -Half), Y = Centre.Y + (i & 2 ? Half : -Half);
		H = FMath::Max(H, ASIWorld::HeightAt(X, Y));
	}
	return H;
}

FPlacement ASIBuilding::Plan(EPiece Piece, const FVector& Aim, const FVector& PlayerPos, float PlayerYaw) const
{
	FPlacement Out;
	Out.Piece = Piece;
	Out.bValid = true;
	auto Fail = [&Out](const TCHAR* Why) { if (Out.bValid) { Out.bValid = false; Out.Why = Why; } };

	const FIntPoint Cell = CellOf(Aim);
	const FVector2D Centre = CentreOf(Cell);
	switch (Piece)
	{
	case EPiece::Floor:
	{
		// Line up with a neighbouring floor if there is one, so rooms are level.
		float Top = GroundTop(Centre, C * 0.5f) + 15.f;
		for (const FIntPoint& D : { FIntPoint(1, 0), FIntPoint(-1, 0), FIntPoint(0, 1), FIntPoint(0, -1) })
		{
			const float N = FloorTop(Cell + D);
			if (N > -1e8f && FMath::Abs(N - Top) < 150.f)
			{
				Top = N;
				break;
			}
		}
		Out.Transform = FTransform(FRotator::ZeroRotator, FVector(Centre, Top - FloorDepth * 0.5f), FVector(C / 100.f, C / 100.f, FloorDepth / 100.f));
		Out.Key = FIntVector(Cell.X, Cell.Y, 0);
		if (Floors.Contains(Cell)) Fail(TEXT("這裡已經有地板"));
		if (Top - ASIWorld::HeightAt(Centre.X, Centre.Y) > 160.f) Fail(TEXT("地面太陡"));
		break;
	}
	case EPiece::Wall:
	{
		// The cell edge nearest to the aim point.
		const float Fx = Aim.X / C - Cell.X, Fy = Aim.Y / C - Cell.Y;
		const float Ds[4] = { Fx, 1.f - Fx, Fy, 1.f - Fy };
		int32 Edge = 0;
		for (int32 i = 1; i < 4; ++i)
		{
			if (Ds[i] < Ds[Edge]) Edge = i;
		}
		FVector2D Mid;
		FIntPoint Other;
		if (Edge < 2)
		{
			const int32 X = Cell.X + Edge;
			Out.Key = FIntVector(X, Cell.Y, 0);
			Mid = FVector2D(X * C, (Cell.Y + 0.5f) * C);
			Other = FIntPoint(X - (Edge == 0 ? 1 : 0), Cell.Y);
			if (Edge == 1) Other = FIntPoint(X, Cell.Y);
		}
		else
		{
			const int32 Y = Cell.Y + (Edge - 2);
			Out.Key = FIntVector(Cell.X, Y, 1);
			Mid = FVector2D((Cell.X + 0.5f) * C, Y * C);
			Other = FIntPoint(Cell.X, Edge == 2 ? Y - 1 : Y);
		}
		float Base = FMath::Max(FloorTop(Cell), FloorTop(Other));
		const bool bOnFloor = Base > -1e8f;
		if (!bOnFloor)
		{
			Base = GroundTop(Mid, C * 0.25f);
		}
		const float Sink = bOnFloor ? 0.f : 60.f;   // without a floor, dig the wall in a little
		const float Height = Isle::WallHeight + Sink;
		const float Yaw = Out.Key.Z == 0 ? 90.f : 0.f;
		Out.Transform = FTransform(FRotator(0, Yaw, 0), FVector(Mid, Base - Sink + Height * 0.5f), FVector(C / 100.f + 0.15f, 0.25f, Height / 100.f));
		if (Walls.Contains(Out.Key)) Fail(TEXT("這裡已經有牆"));
		break;
	}
	case EPiece::Roof:
	{
		float Base = FloorTop(Cell);
		if (Base < -1e8f)
		{
			Base = GroundTop(Centre, C * 0.5f);
		}
		const float Under = Base + Isle::WallHeight;
		Out.Transform = FTransform(FRotator::ZeroRotator, FVector(Centre, Under + RoofThick * 0.5f), FVector(C / 100.f + 0.3f, C / 100.f + 0.3f, RoofThick / 100.f));
		Out.Key = FIntVector(Cell.X, Cell.Y, 2);
		if (Roofs.Contains(Cell)) Fail(TEXT("這裡已經有屋頂"));
		break;
	}
	case EPiece::Campfire:
	case EPiece::Beacon:
	{
		// On whatever the player is aiming at: the ground or a floor.
		const float Floor = FloorTop(CellOf(Aim));
		const float G = FMath::Max(ASIWorld::HeightAt(Aim.X, Aim.Y), Floor);
		const bool bFire = Piece == EPiece::Campfire;
		Out.Transform = FTransform(FRotator(0, PlayerYaw, 0), FVector(Aim.X, Aim.Y, G), bFire ? FVector(1.4f, 1.4f, 0.4f) : FVector(1.6f, 1.6f, 4.0f));
		Out.Key = FIntVector(FMath::RoundToInt(Aim.X), FMath::RoundToInt(Aim.Y), 3);
		for (const FVector& F : Campfires)
		{
			if (FVector::Dist2D(F, Aim) < 250.f) Fail(TEXT("離其他營火太近"));
		}
		if (Floor < -1e8f && ASIWorld::NormalAt(Aim.X, Aim.Y).Z < 0.85f) Fail(TEXT("地面太陡"));
		if (!bFire && bBeacon) Fail(TEXT("信標已經建好了"));
		break;
	}
	default:
		break;
	}

	const FVector Where = Out.Transform.GetLocation();
	if (ASIWorld::HeightAt(Where.X, Where.Y) < 60.f) Fail(TEXT("不能蓋在水裡"));
	if (FVector::Dist2D(Where, PlayerPos) > Reach) Fail(TEXT("太遠了"));
	if (Piece != EPiece::Wall && Piece != EPiece::Roof && Resources
		&& Resources->IsCrowded(Where, Piece == EPiece::Floor ? C * 0.45f : 120.f))
	{
		Fail(TEXT("有樹或石頭擋住"));
	}
	return Out;
}

void ASIBuilding::ShowPreview(const FPlacement* P)
{
	if (!P)
	{
		Ghost->SetVisibility(false);
		return;
	}
	const bool bRound = P->Piece == EPiece::Campfire || P->Piece == EPiece::Beacon;
	Ghost->SetStaticMesh(Isle::Mesh(bRound ? TEXT("Cylinder") : TEXT("Cube")));
	FTransform T = P->Transform;
	if (bRound)
	{
		T.AddToTranslation(FVector(0, 0, T.GetScale3D().Z * 50.f));
	}
	Ghost->SetWorldTransform(T);
	Ghost->SetVisibility(true);
	GhostMat->SetVectorParameterValue(TEXT("Color"), P->bValid ? FLinearColor(0.2f, 1.f, 0.4f) : FLinearColor(1.f, 0.15f, 0.1f));
}

void ASIBuilding::Place(const FPlacement& P)
{
	const FTransform& T = P.Transform;
	const FVector L = T.GetLocation();
	auto Add = [this](int32 Part, const FTransform& X)
	{
		const int32 I = Parts[Part]->AddInstance(X, true);
		Parts[Part]->SetCustomDataValue(I, 0, FMath::FRand(), true);
	};
	switch (P.Piece)
	{
	case EPiece::Floor:
		Add(FloorC, T);
		Floors.Add(FIntPoint(P.Key.X, P.Key.Y), L.Z + T.GetScale3D().Z * 50.f);
		break;
	case EPiece::Wall:
		Add(WallC, T);
		Walls.Add(P.Key);
		break;
	case EPiece::Roof:
		Add(RoofC, T);
		Roofs.Add(FIntPoint(P.Key.X, P.Key.Y), L.Z - T.GetScale3D().Z * 50.f);
		break;
	case EPiece::Campfire:
	case EPiece::Beacon:
	{
		const bool bFire = P.Piece == EPiece::Campfire;
		if (bFire)
		{
			// A ring of stones, crossed logs, and a flame with its light.
			for (int32 i = 0; i < 8; ++i)
			{
				const FVector Off = FRotator(0, i * 45.f, 0).RotateVector(FVector(70.f, 0, 0));
				Add(StoneC, FTransform(FRotator(0, i * 45.f, 0), L + Off + FVector(0, 0, 8.f), FVector(0.38f, 0.3f, 0.25f)));
			}
			for (int32 i = 0; i < 3; ++i)
			{
				Add(LogC, FTransform(FRotator(80.f, i * 60.f + T.Rotator().Yaw, 0), L + FVector(0, 0, 15.f), FVector(0.18f, 0.18f, 1.1f)));
			}
			Campfires.Add(L);
		}
		else
		{
			// A cairn of stone with a great crystal on top, shining a beam into the sky.
			for (int32 i = 0; i < 4; ++i)
			{
				const float S = 2.2f - i * 0.4f;
				Add(StoneC, FTransform(FRotator(0, i * 30.f, 0), L + FVector(0, 0, 40.f + i * 70.f), FVector(S, S, 1.0f)));
			}
			Add(GlowC, FTransform(FRotator::ZeroRotator, L + FVector(0, 0, 400.f), FVector(0.9f, 0.9f, 2.2f)));
			Add(GlowC, FTransform(FRotator(180.f, 0, 0), L + FVector(0, 0, 290.f), FVector(0.9f, 0.9f, 1.0f)));
			Add(GlowC, FTransform(FRotator::ZeroRotator, L + FVector(0, 0, 20000.f), FVector(0.25f, 0.25f, 390.f)));
			bBeacon = true;
			Beacon = L;
		}
		UStaticMeshComponent* Flame = NewObject<UStaticMeshComponent>(this);
		Flame->SetupAttachment(RootComponent);
		Flame->RegisterComponent();
		Flame->SetStaticMesh(Isle::Mesh(bFire ? TEXT("Cone") : TEXT("Sphere")));
		Flame->SetMaterial(0, Isle::Tinted(TEXT("M_Fire"), bFire ? FLinearColor(1.f, 0.42f, 0.08f) : FLinearColor(0.5f, 0.2f, 1.f), this));
		Flame->SetWorldLocation(L + FVector(0, 0, bFire ? 55.f : 400.f));
		Flame->SetWorldScale3D(bFire ? FVector(0.7f, 0.7f, 1.1f) : FVector(1.3f));
		Flame->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		Flame->SetCastShadow(false);
		Flames.Add(Flame);

		UPointLightComponent* Light = NewObject<UPointLightComponent>(this);
		Light->SetupAttachment(RootComponent);
		Light->RegisterComponent();
		Light->SetWorldLocation(L + FVector(0, 0, bFire ? 90.f : 450.f));
		Light->SetLightColor(bFire ? FLinearColor(1.f, 0.5f, 0.18f) : FLinearColor(0.6f, 0.3f, 1.f));
		Light->SetIntensity(bFire ? 9000.f : 60000.f);
		Light->SetAttenuationRadius(bFire ? 1400.f : 5000.f);
		Light->SetCastShadows(bFire);
		Lights.Add(Light);
		break;
	}
	default:
		break;
	}
	++Counts[int32(P.Piece)];
}

bool ASIBuilding::IsSheltered(const FVector& Feet) const
{
	const float* Under = Roofs.Find(CellOf(Feet));
	return Under && *Under > Feet.Z && *Under - Feet.Z < 600.f;
}

float ASIBuilding::CampfireDistance(const FVector& P) const
{
	float Best = 1e9f;
	for (const FVector& F : Campfires)
	{
		Best = FMath::Min(Best, float(FVector::Dist(F, P)));
	}
	return Best;
}

bool ASIBuilding::RespawnPoint(FVector& Out) const
{
	if (Campfires.IsEmpty())
	{
		return false;
	}
	Out = Campfires.Last() + FVector(150.f, 0, 0);
	Out.Z = FMath::Max(ASIWorld::HeightAt(Out.X, Out.Y), FloorTop(CellOf(Out))) + 120.f;
	return true;
}

void ASIBuilding::Tick(float Dt)
{
	Super::Tick(Dt);
	Clock += Dt;
	// Flames lick and lights flicker.
	for (int32 i = 0; i < Flames.Num(); ++i)
	{
		const float F = 0.85f + 0.1f * FMath::Sin(Clock * 13.f + i * 2.f) + 0.07f * FMath::Sin(Clock * 29.f + i);
		const bool bFire = Lights[i]->GetLightColor().B < 0.5f;
		if (bFire)
		{
			Flames[i]->SetWorldScale3D(FVector(0.7f, 0.7f, 1.1f * F));
			Lights[i]->SetIntensity(9000.f * F);
		}
		else
		{
			Flames[i]->SetWorldScale3D(FVector(1.3f * (0.9f + 0.1f * FMath::Sin(Clock * 2.f))));
		}
	}
}
