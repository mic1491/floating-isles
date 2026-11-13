#include "SIResources.h"
#include "SIUtil.h"
#include "SIWorld.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Math/RandomStream.h"

namespace
{
	enum { Trunk, Canopy, PineTop, RockC, BushC, BerryC, CrystalC, NumComps };
	const float RegrowSeconds = 150.f;
	const float Hidden = -200000.f;   // instances are hidden by moving them deep below the island

	bool GoodGround(float X, float Y, float MinH, float MaxH, float MinUp)
	{
		const float H = ASIWorld::HeightAt(X, Y);
		return H > MinH && H < MaxH && ASIWorld::NormalAt(X, Y).Z > MinUp;
	}
}

ASIResources::ASIResources()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void ASIResources::BeginPlay()
{
	Super::BeginPlay();
	struct FLook { const TCHAR* Shape; const TCHAR* Mat; FLinearColor Colour; bool bSolid; };
	const FLook Looks[NumComps] = {
		{ TEXT("Cylinder"), TEXT("M_Prop"), FLinearColor(0.11f, 0.07f, 0.04f), true },
		{ TEXT("Sphere"),   TEXT("M_Prop"), FLinearColor(0.06f, 0.17f, 0.03f), false },
		{ TEXT("Cone"),     TEXT("M_Prop"), FLinearColor(0.025f, 0.09f, 0.04f), false },
		{ TEXT("Sphere"),   TEXT("M_Prop"), FLinearColor(0.20f, 0.19f, 0.17f), true },
		{ TEXT("Sphere"),   TEXT("M_Prop"), FLinearColor(0.08f, 0.22f, 0.05f), false },
		{ TEXT("Sphere"),   TEXT("M_Prop"), FLinearColor(0.55f, 0.03f, 0.05f), false },
		{ TEXT("Cone"),     TEXT("M_Glow"), FLinearColor(0.45f, 0.15f, 1.0f), false },
	};
	for (const FLook& L : Looks)
	{
		UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(this);
		C->SetupAttachment(RootComponent);
		C->RegisterComponent();
		C->SetStaticMesh(Isle::Mesh(L.Shape));
		C->SetMaterial(0, Isle::Tinted(L.Mat, L.Colour, this));
		C->SetNumCustomDataFloats(2);
		if (L.bSolid)
		{
			C->SetCollisionProfileName(TEXT("BlockAll"));
		}
		else
		{
			C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		}
		Comps.Add(C);
	}
	Populate();
}

int32 ASIResources::AddPart(FNode& N, int32 Comp, const FTransform& T)
{
	const int32 I = Comps[Comp]->AddInstance(T, true);
	Comps[Comp]->SetCustomDataValue(I, 0, FMath::FRand(), false);
	N.Parts.Add({ Comp, I, T });
	return I;
}

void ASIResources::Populate()
{
	FRandomStream Rng(77031);
	const FVector Start = ASIWorld::StartLocation();
	auto ClearOfStart = [&Start](float X, float Y, float R) { return FVector2D::Distance(FVector2D(X, Y), FVector2D(Start)) > R; };

	// Woods: noise decides where forest grows thick, so there are groves and open meadows.
	int32 Trees = 0;
	for (int32 Try = 0; Try < 60000 && Trees < 1500; ++Try)
	{
		const float X = Rng.FRandRange(-ASIWorld::IslandRadius, ASIWorld::IslandRadius);
		const float Y = Rng.FRandRange(-ASIWorld::IslandRadius, ASIWorld::IslandRadius);
		const float Density = FMath::PerlinNoise2D(FVector2D(X, Y) / 22000.f + FVector2D(3.3f, 7.1f)) * 0.5f + 0.5f;
		if (Rng.FRand() > Density * Density * 1.6f || !GoodGround(X, Y, 350.f, 7000.f, 0.8f) || !ClearOfStart(X, Y, 1800.f))
		{
			continue;
		}
		const float G = ASIWorld::HeightAt(X, Y);
		const bool bPine = G > 2800.f ? Rng.FRand() < 0.8f : Rng.FRand() < 0.3f;
		FNode N;
		N.Kind = bPine ? ENodeKind::Pine : ENodeKind::Tree;
		N.Pos = FVector(X, Y, G);
		N.Radius = 60.f;
		N.MaxHits = N.Hits = 5;
		const float Yaw = Rng.FRandRange(0.f, 360.f);
		if (bPine)
		{
			const float H = Rng.FRandRange(700.f, 1100.f);
			AddPart(N, Trunk, FTransform(FRotator(0, Yaw, 0), FVector(X, Y, G + H * 0.5f - 30.f), FVector(0.45f, 0.45f, H / 100.f)));
			AddPart(N, PineTop, FTransform(FRotator(0, Yaw, 0), FVector(X, Y, G + H * 0.5f), FVector(4.2f, 4.2f, H / 160.f)));
			AddPart(N, PineTop, FTransform(FRotator(0, Yaw + 40.f, 0), FVector(X, Y, G + H * 0.85f), FVector(3.0f, 3.0f, H / 220.f)));
		}
		else
		{
			const float H = Rng.FRandRange(450.f, 750.f);
			const float S = Rng.FRandRange(4.f, 6.f);
			AddPart(N, Trunk, FTransform(FRotator(0, Yaw, 0), FVector(X, Y, G + H * 0.5f - 30.f), FVector(0.6f, 0.6f, H / 100.f)));
			AddPart(N, Canopy, FTransform(FRotator(0, Yaw, 0), FVector(X, Y, G + H + S * 25.f), FVector(S, S * 0.9f, S * 0.75f)));
			AddPart(N, Canopy, FTransform(FRotator(0, Yaw, 0), FVector(X + S * 20.f, Y, G + H + S * 5.f), FVector(S * 0.6f)));
		}
		Nodes.Add(MoveTemp(N));
		++Trees;
	}

	// Rocks: more on the hills, a few scattered in the meadows.
	int32 Rocks = 0;
	for (int32 Try = 0; Try < 30000 && Rocks < 520; ++Try)
	{
		const float X = Rng.FRandRange(-ASIWorld::IslandRadius, ASIWorld::IslandRadius);
		const float Y = Rng.FRandRange(-ASIWorld::IslandRadius, ASIWorld::IslandRadius);
		const float G = ASIWorld::HeightAt(X, Y);
		if (!GoodGround(X, Y, 150.f, 9500.f, 0.65f) || !ClearOfStart(X, Y, 1200.f) || Rng.FRand() > 0.25f + G / 6000.f)
		{
			continue;
		}
		FNode N;
		N.Kind = ENodeKind::Rock;
		const FVector S(Rng.FRandRange(1.6f, 3.2f), Rng.FRandRange(1.3f, 2.6f), Rng.FRandRange(0.9f, 1.7f));
		N.Pos = FVector(X, Y, G);
		N.Radius = S.X * 45.f;
		N.MaxHits = N.Hits = 6;
		AddPart(N, RockC, FTransform(FRotator(Rng.FRandRange(-15, 15), Rng.FRandRange(0, 360), Rng.FRandRange(-15, 15)), FVector(X, Y, G + S.Z * 25.f), S));
		Nodes.Add(MoveTemp(N));
		++Rocks;
	}

	// Berry bushes along the forest edges and meadows.
	int32 Bushes = 0;
	for (int32 Try = 0; Try < 30000 && Bushes < 650; ++Try)
	{
		const float X = Rng.FRandRange(-ASIWorld::IslandRadius, ASIWorld::IslandRadius);
		const float Y = Rng.FRandRange(-ASIWorld::IslandRadius, ASIWorld::IslandRadius);
		if (!GoodGround(X, Y, 300.f, 4500.f, 0.85f) || !ClearOfStart(X, Y, 600.f))
		{
			continue;
		}
		const float G = ASIWorld::HeightAt(X, Y);
		FNode N;
		N.Kind = ENodeKind::Bush;
		N.Pos = FVector(X, Y, G);
		N.Radius = 70.f;
		N.MaxHits = N.Hits = 3;
		const float S = Rng.FRandRange(1.2f, 1.8f);
		AddPart(N, BushC, FTransform(FRotator(0, Rng.FRandRange(0, 360), 0), FVector(X, Y, G + S * 30.f), FVector(S, S, S * 0.8f)));
		for (int32 b = 0; b < 6; ++b)
		{
			const float A = b * 60.f + Rng.FRandRange(-20.f, 20.f);
			const FVector Dir = FRotator(Rng.FRandRange(10.f, 50.f), A, 0).Vector();
			AddPart(N, BerryC, FTransform(FRotator::ZeroRotator, FVector(X, Y, G + S * 30.f) + Dir * S * 48.f, FVector(0.14f)));
		}
		Nodes.Add(MoveTemp(N));
		++Bushes;
	}

	// A few bushes and rocks close to where the player wakes, so the first steps are quick.
	for (int32 i = 0; i < 6; ++i)
	{
		const FVector P = Start + FRotator(0, i * 60.f + 20.f, 0).Vector() * (700.f + 150.f * i);
		FNode N;
		const bool bRock = i % 2 == 1;
		const float G = ASIWorld::HeightAt(P.X, P.Y);
		N.Kind = bRock ? ENodeKind::Rock : ENodeKind::Bush;
		N.Pos = FVector(P.X, P.Y, G);
		N.Radius = bRock ? 90.f : 70.f;
		N.MaxHits = N.Hits = bRock ? 6 : 3;
		if (bRock)
		{
			AddPart(N, RockC, FTransform(FRotator(5, i * 40.f, 0), FVector(P.X, P.Y, G + 30.f), FVector(2.0f, 1.7f, 1.2f)));
		}
		else
		{
			AddPart(N, BushC, FTransform(FRotator::ZeroRotator, FVector(P.X, P.Y, G + 45.f), FVector(1.5f, 1.5f, 1.2f)));
			for (int32 b = 0; b < 6; ++b)
			{
				AddPart(N, BerryC, FTransform(FRotator::ZeroRotator, FVector(P.X, P.Y, G + 45.f) + FRotator(30, b * 60.f, 0).Vector() * 72.f, FVector(0.14f)));
			}
		}
		Nodes.Add(MoveTemp(N));
	}
	for (UInstancedStaticMeshComponent* C : Comps)
	{
		C->MarkRenderStateDirty();
	}
}

void ASIResources::SetVisible(FNode& N, bool bVisible)
{
	for (const FPart& P : N.Parts)
	{
		FTransform T = P.Transform;
		if (!bVisible)
		{
			T.AddToTranslation(FVector(0, 0, Hidden));
		}
		Comps[P.Comp]->UpdateInstanceTransform(P.Instance, T, true, true, true);
	}
}

bool ASIResources::Strike(const FVector& From, const FVector& Facing, float Reach, bool bAxe, bool bPick, FHarvest& Out)
{
	const FVector2D F2 = FVector2D(Facing).GetSafeNormal();
	int32 Best = INDEX_NONE;
	float BestScore = TNumericLimits<float>::Max();
	for (int32 i = 0; i < Nodes.Num(); ++i)
	{
		const FNode& N = Nodes[i];
		if (N.bGone)
		{
			continue;
		}
		const FVector2D To = FVector2D(N.Pos - From);
		const float Dist = To.Size() - N.Radius;
		if (Dist > Reach || FMath::Abs(N.Pos.Z - From.Z) > 400.f)
		{
			continue;
		}
		const float Dot = To.Size() > 1.f ? FVector2D::DotProduct(To / To.Size(), F2) : 1.f;
		if (Dot < 0.2f && Dist > 30.f)
		{
			continue;
		}
		const float Score = Dist - Dot * 60.f;
		if (Score < BestScore)
		{
			BestScore = Score;
			Best = i;
		}
	}
	if (Best == INDEX_NONE)
	{
		return false;
	}

	FNode& N = Nodes[Best];
	Out = FHarvest();
	Out.Kind = N.Kind;
	Out.Where = N.Pos + FVector(0, 0, 100.f);
	switch (N.Kind)
	{
	case ENodeKind::Tree:
	case ENodeKind::Pine:
		Out.Item = EItem::Wood;
		Out.Amount = bAxe ? 2 : 1;
		break;
	case ENodeKind::Rock:
		Out.Item = EItem::Stone;
		Out.Amount = bPick ? 2 : 1;
		break;
	case ENodeKind::Bush:
		Out.Item = EItem::Fiber;
		Out.Amount = 1;
		Out.Extra = EItem::Berry;
		Out.ExtraAmount = 2;
		break;
	case ENodeKind::Crystal:
		Out.Item = EItem::Crystal;
		Out.Amount = 1;
		break;
	}
	--N.Hits;
	N.Flash = 1.f;
	N.Shake = 1.f;
	Flashing.AddUnique(Best);

	if (N.Kind == ENodeKind::Bush)
	{
		// Each blow strips a pair of berries off the bush.
		int32 Shown = 0;
		for (FPart& P : N.Parts)
		{
			if (P.Comp == BerryC && P.Transform.GetLocation().Z > Hidden * 0.5f && Shown < 2)
			{
				P.Transform.AddToTranslation(FVector(0, 0, Hidden));
				Comps[P.Comp]->UpdateInstanceTransform(P.Instance, P.Transform, true, true, true);
				++Shown;
			}
		}
	}
	if (N.Hits <= 0)
	{
		Out.bDepleted = true;
		N.bGone = true;
		N.RespawnAt = N.Kind == ENodeKind::Crystal ? -1.f : Clock + RegrowSeconds;
		SetVisible(N, false);
		if (N.Kind == ENodeKind::Bush)
		{
			// Put the berries back where they belong, so they come back with the bush.
			for (FPart& P : N.Parts)
			{
				if (P.Transform.GetLocation().Z < Hidden * 0.5f)
				{
					P.Transform.AddToTranslation(FVector(0, 0, -Hidden));
				}
			}
		}
	}
	return true;
}

bool ASIResources::IsCrowded(const FVector& P, float Radius) const
{
	for (const FNode& N : Nodes)
	{
		if (!N.bGone && N.Kind != ENodeKind::Bush && N.Kind != ENodeKind::Crystal
			&& FVector2D::Distance(FVector2D(N.Pos), FVector2D(P)) < Radius + N.Radius && FMath::Abs(N.Pos.Z - P.Z) < 600.f)
		{
			return true;
		}
	}
	return false;
}

void ASIResources::SpawnCrystal(const FVector& Near)
{
	const float G = ASIWorld::HeightAt(Near.X, Near.Y);
	if (G < 100.f)
	{
		return;
	}
	FNode N;
	N.Kind = ENodeKind::Crystal;
	N.Pos = FVector(Near.X, Near.Y, G);
	N.Radius = 50.f;
	N.MaxHits = N.Hits = 2;
	for (int32 i = 0; i < 3; ++i)
	{
		const float Tilt = i == 0 ? 0.f : 25.f;
		const float H = i == 0 ? 1.8f : 1.1f;
		const FRotator R(Tilt, i * 120.f + FMath::FRandRange(0.f, 40.f), 0.f);
		const FVector Off = R.RotateVector(FVector(0, 0, H * 50.f));
		AddPart(N, CrystalC, FTransform(R, N.Pos + Off - FVector(0, 0, 10.f), FVector(0.45f, 0.45f, H)));
	}
	Comps[CrystalC]->MarkRenderStateDirty();
	Nodes.Add(MoveTemp(N));
}

int32 ASIResources::CrystalsLeft() const
{
	int32 Count = 0;
	for (const FNode& N : Nodes)
	{
		Count += N.Kind == ENodeKind::Crystal && !N.bGone;
	}
	return Count;
}

bool ASIResources::NearestCrystal(const FVector& P, FVector& Out) const
{
	float Best = TNumericLimits<float>::Max();
	for (const FNode& N : Nodes)
	{
		if (N.Kind == ENodeKind::Crystal && !N.bGone)
		{
			const float D = FVector::DistSquared(N.Pos, P);
			if (D < Best)
			{
				Best = D;
				Out = N.Pos;
			}
		}
	}
	return Best < TNumericLimits<float>::Max();
}

void ASIResources::Tick(float Dt)
{
	Super::Tick(Dt);
	Clock += Dt;

	// Struck things flash and shiver for a moment.
	for (int32 k = Flashing.Num() - 1; k >= 0; --k)
	{
		FNode& N = Nodes[Flashing[k]];
		N.Flash = FMath::Max(N.Flash - Dt * 4.f, 0.f);
		N.Shake = FMath::Max(N.Shake - Dt * 3.f, 0.f);
		if (!N.bGone)
		{
			const float Wobble = FMath::Sin(Clock * 45.f) * 4.f * N.Shake;
			for (const FPart& P : N.Parts)
			{
				Comps[P.Comp]->SetCustomDataValue(P.Instance, 1, N.Flash * 0.6f, true);
				if (P.Transform.GetLocation().Z > Hidden * 0.5f)
				{
					// Lean about the base of the thing, so a tree sways from its roots.
					FTransform T = P.Transform;
					const FVector Arm = T.GetLocation() - N.Pos;
					const FQuat Lean(FVector(1, 0, 0), FMath::DegreesToRadians(Wobble));
					T.SetLocation(N.Pos + Lean.RotateVector(Arm));
					T.SetRotation(Lean * T.GetRotation());
					Comps[P.Comp]->UpdateInstanceTransform(P.Instance, T, true, false, true);
				}
			}
		}
		if (N.Flash <= 0.f && N.Shake <= 0.f)
		{
			Flashing.RemoveAtSwap(k);
		}
	}
	// Felled trees, broken rocks and stripped bushes grow back after a while.
	for (FNode& N : Nodes)
	{
		if (N.bGone && N.RespawnAt > 0.f && Clock > N.RespawnAt)
		{
			N.bGone = false;
			N.Hits = N.MaxHits;
			N.RespawnAt = -1.f;
			SetVisible(N, true);
		}
	}
}
