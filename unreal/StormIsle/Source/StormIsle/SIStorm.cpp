#include "SIStorm.h"
#include "SIBuilding.h"
#include "SICharacter.h"
#include "SIEnemy.h"
#include "SIResources.h"
#include "SIUtil.h"
#include "SIWorld.h"
#include "ProceduralMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace
{
	const float FirstCalm = 480.f;      // the first storm comes after eight minutes, unless the story calls it sooner
	const float Calm = 420.f;
	const float WarningTime = 40.f;
	const float Speed = 800.f;          // cm/s the storm travels
	const float Margin = 30000.f;       // how far beyond the player the storm starts and ends
	const float WallHeight = 45000.f;

	FVector Ground(const FVector2D& P)
	{
		return FVector(P, ASIWorld::HeightAt(P.X, P.Y));
	}
}

ASIStorm::ASIStorm()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void ASIStorm::BeginPlay()
{
	Super::BeginPlay();
	World = TActorIterator<ASIWorld>(GetWorld()) ? *TActorIterator<ASIWorld>(GetWorld()) : nullptr;
	Resources = TActorIterator<ASIResources>(GetWorld()) ? *TActorIterator<ASIResources>(GetWorld()) : nullptr;
	Building = TActorIterator<ASIBuilding>(GetWorld()) ? *TActorIterator<ASIBuilding>(GetWorld()) : nullptr;
	BuildWall();
	Phase = EStormPhase::Calm;
	PhaseLeft = FirstCalm;
}

void ASIStorm::BuildWall()
{
	// An open tube one unit across and one tall, scaled to the storm's size: V runs 1 at the foot to 0 at the top.
	const int32 Segs = 96;
	TArray<FVector> V, N;
	TArray<FVector2D> UV;
	TArray<FLinearColor> Col;
	TArray<FProcMeshTangent> Tan;
	TArray<int32> Tri;
	for (int32 i = 0; i <= Segs; ++i)
	{
		const float A = 2.f * PI * i / Segs;
		const FVector Out(FMath::Cos(A), FMath::Sin(A), 0.f);
		for (int32 j = 0; j < 2; ++j)
		{
			V.Add(Out + FVector(0, 0, j));
			N.Add(Out);
			UV.Add(FVector2D(float(i) / Segs, 1.f - j));
			Col.Add(FLinearColor::White);
			Tan.Add(FProcMeshTangent(-Out.Y, Out.X, 0.f));
		}
	}
	for (int32 i = 0; i < Segs; ++i)
	{
		const int32 A = i * 2, B = A + 1, C = A + 2, D = A + 3;
		Tri.Append({ A, C, B, B, C, D });
	}
	auto Make = [&](const TCHAR* Name)
	{
		UProceduralMeshComponent* M = NewObject<UProceduralMeshComponent>(this, Name);
		M->SetupAttachment(RootComponent);
		M->RegisterComponent();
		M->CreateMeshSection_LinearColor(0, V, Tri, N, UV, Col, Tan, false);
		M->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		M->SetCastShadow(false);
		M->SetVisibility(false);
		return M;
	};
	Wall = Make(TEXT("Wall"));
	InnerWall = Make(TEXT("InnerWall"));
	WallMat = Isle::Tinted(TEXT("M_Storm"), FLinearColor(0.45f, 0.12f, 0.9f), this);
	Wall->SetMaterial(0, WallMat);
	InnerWall->SetMaterial(0, Isle::Tinted(TEXT("M_Storm"), FLinearColor(0.25f, 0.06f, 0.55f), this));

	Bolt = NewObject<UStaticMeshComponent>(this);
	Bolt->SetupAttachment(RootComponent);
	Bolt->RegisterComponent();
	Bolt->SetStaticMesh(Isle::Mesh(TEXT("Cylinder")));
	Bolt->SetMaterial(0, Isle::Tinted(TEXT("M_Glow"), FLinearColor(0.75f, 0.6f, 1.f), this));
	Bolt->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Bolt->SetCastShadow(false);
	Bolt->SetVisibility(false);

	Flash = NewObject<UPointLightComponent>(this);
	Flash->SetupAttachment(RootComponent);
	Flash->RegisterComponent();
	Flash->SetLightColor(FLinearColor(0.7f, 0.6f, 1.f));
	Flash->SetIntensity(0.f);
	Flash->SetAttenuationRadius(6000.f);
	Flash->SetCastShadows(false);

	for (int32 i = 0; i < 4; ++i)
	{
		UStaticMeshComponent* M = NewObject<UStaticMeshComponent>(this);
		M->SetupAttachment(RootComponent);
		M->RegisterComponent();
		M->SetStaticMesh(Isle::Mesh(TEXT("Cylinder")));
		M->SetMaterial(0, Isle::Tinted(TEXT("M_Ghost"), FLinearColor(1.f, 0.3f, 0.9f), this));
		M->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		M->SetCastShadow(false);
		M->SetVisibility(false);
		MarkPool.Add(M);
	}
}

void ASIStorm::BringForward(float Seconds)
{
	if (Phase == EStormPhase::Calm && PhaseLeft > Seconds)
	{
		PhaseLeft = Seconds;
	}
}

bool ASIStorm::Protected(const FVector& P) const
{
	return Building && Building->HasBeacon() && FVector::Dist2D(P, Building->BeaconLocation()) < BeaconReach;
}

bool ASIStorm::IsInside(const FVector& P) const
{
	return Phase == EStormPhase::Raging && FVector2D::Distance(FVector2D(P), Pos) < R && !Protected(P);
}

void ASIStorm::StartStorm()
{
	// Aim the storm straight across where the player is now, from a random side.
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	const FVector2D Target = Player ? FVector2D(Player->GetActorLocation()) : FVector2D::ZeroVector;
	const float A = FMath::FRandRange(0.f, 2.f * PI);
	Dir = FVector2D(FMath::Cos(A), FMath::Sin(A));
	R = FMath::FRandRange(24000.f, 30000.f);
	Pos = Target - Dir * (R + Margin);
	Travelled = 0.f;
	Journey = 2.f * (R + Margin);
	Wall->SetVisibility(true);
	InnerWall->SetVisibility(true);
}

void ASIStorm::EndStorm()
{
	Wall->SetVisibility(false);
	InnerWall->SetVisibility(false);
	Bolt->SetVisibility(false);
	for (FStrike& S : Strikes)
	{
		S.Mark->SetVisibility(false);
	}
	Strikes.Empty();
	++StormsPassed;

	// The storm leaves crystals behind: a handful near the player and some along its track.
	if (Resources)
	{
		const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
		const FVector2D Near = Player ? FVector2D(Player->GetActorLocation()) : Pos;
		int32 Placed = 0;
		for (int32 Try = 0; Try < 80 && Placed < 7; ++Try)
		{
			const FVector2D P = Near + FVector2D(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f)).GetSafeNormal() * FMath::FRandRange(900.f, 4500.f);
			if (ASIWorld::HeightAt(P.X, P.Y) > 120.f)
			{
				Resources->SpawnCrystal(Ground(P));
				++Placed;
			}
		}
		for (int32 i = 0; i < 6; ++i)
		{
			const FVector2D P = Pos - Dir * FMath::FRandRange(0.f, Journey) + FVector2D(-Dir.Y, Dir.X) * FMath::FRandRange(-R, R) * 0.7f;
			if (ASIWorld::HeightAt(P.X, P.Y) > 120.f)
			{
				Resources->SpawnCrystal(Ground(P));
			}
		}
	}
}

void ASIStorm::Lightning(const FVector& Where)
{
	Bolt->SetWorldLocation(Where + FVector(0, 0, 12000.f));
	Bolt->SetWorldScale3D(FVector(0.35f, 0.35f, 240.f));
	Bolt->SetWorldRotation(FRotator(FMath::FRandRange(-4.f, 4.f), 0.f, FMath::FRandRange(-4.f, 4.f)));
	Bolt->SetVisibility(true);
	BoltTime = 0.18f;
	Flash->SetWorldLocation(Where + FVector(0, 0, 600.f));
	Flash->SetIntensity(2.0e6f);
}

void ASIStorm::TickRaging(float Dt)
{
	Travelled += Speed * Dt;
	Pos += Dir * Speed * Dt;
	Clock += Dt;
	Wall->SetWorldLocation(FVector(Pos, -3000.f));
	Wall->SetWorldScale3D(FVector(R, R, WallHeight));
	Wall->SetWorldRotation(FRotator(0.f, Clock * 3.f, 0.f));
	InnerWall->SetWorldLocation(FVector(Pos, -3000.f));
	InnerWall->SetWorldScale3D(FVector(R * 0.97f, R * 0.97f, WallHeight * 0.8f));
	InnerWall->SetWorldRotation(FRotator(0.f, -Clock * 5.f, 0.f));
	if (Travelled >= Journey)
	{
		Phase = EStormPhase::Calm;
		PhaseLeft = Calm;
		EndStorm();
		return;
	}

	ASICharacter* Player = Cast<ASICharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!Player)
	{
		return;
	}
	const FVector P = Player->GetActorLocation();
	const bool bIn = IsInside(P);

	// Lightning: marked on the ground a moment before it hits, so it can be dodged.
	StrikeTimer -= Dt;
	if (bIn && StrikeTimer <= 0.f && !Player->IsDead())
	{
		StrikeTimer = FMath::FRandRange(2.2f, 4.5f);
		FVector2D Where = FVector2D(P) + FVector2D(Player->GetVelocity()) * 0.8f
			+ FVector2D(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f)) * 250.f;
		if (Player->bSheltered)
		{
			// The roof draws the strike away: it lands outside, for show.
			Where = FVector2D(P) + FVector2D(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f)).GetSafeNormal() * 1400.f;
		}
		for (UStaticMeshComponent* M : MarkPool)
		{
			if (!M->IsVisible())
			{
				const FVector G = Ground(Where);
				M->SetWorldLocation(G + FVector(0, 0, 4.f));
				M->SetWorldScale3D(FVector(5.5f, 5.5f, 0.04f));
				M->SetVisibility(true);
				Strikes.Add({ G, 1.1f, M });
				break;
			}
		}
	}
	for (int32 i = Strikes.Num() - 1; i >= 0; --i)
	{
		FStrike& S = Strikes[i];
		S.Left -= Dt;
		S.Mark->SetWorldScale3D(FVector(5.5f * (0.6f + 0.4f * S.Left / 1.1f), 5.5f * (0.6f + 0.4f * S.Left / 1.1f), 0.04f));
		if (S.Left <= 0.f)
		{
			Lightning(S.Where);
			if (FVector::Dist2D(S.Where, P) < 300.f && !Player->bSheltered && FMath::Abs(S.Where.Z - (P.Z - 92.f)) < 400.f)
			{
				Player->Hurt(25.f, S.Where);
				Player->Say(TEXT("被閃電擊中了！"), 1.5f);
			}
			S.Mark->SetVisibility(false);
			Strikes.RemoveAt(i);
		}
	}
	// Far-off bolts for the look of it.
	if (FMath::FRand() < Dt * 0.6f && BoltTime <= 0.f)
	{
		const FVector2D Far = Pos + FVector2D(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f)) * R * 0.8f;
		if (FVector2D::Distance(Far, FVector2D(P)) > 3000.f)
		{
			Lightning(Ground(Far));
		}
	}
}

void ASIStorm::TickWraiths(float Dt)
{
	Wraiths.RemoveAll([](const ASIEnemy* E) { return !IsValid(E); });
	const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!Player)
	{
		return;
	}
	const FVector P = Player->GetActorLocation();
	const bool bStorm = IsInside(P);
	const bool bNight = World && World->IsNight() && !Protected(P);
	if (!bStorm && !bNight)
	{
		return;
	}
	SpawnTimer -= Dt;
	const int32 Max = bStorm ? 5 : 3;
	if (SpawnTimer > 0.f || Wraiths.Num() >= Max)
	{
		return;
	}
	SpawnTimer = bStorm ? 7.f : 22.f;
	for (int32 Try = 0; Try < 12; ++Try)
	{
		const FVector2D At = FVector2D(P) + FVector2D(FMath::FRandRange(-1.f, 1.f), FMath::FRandRange(-1.f, 1.f)).GetSafeNormal() * FMath::FRandRange(1800.f, 3200.f);
		const float G = ASIWorld::HeightAt(At.X, At.Y);
		if (G < 120.f || Protected(FVector(At, G)))
		{
			continue;
		}
		FActorSpawnParameters Params;
		Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
		if (ASIEnemy* E = GetWorld()->SpawnActor<ASIEnemy>(FVector(At, G + 110.f), FRotator::ZeroRotator, Params))
		{
			Wraiths.Add(E);
		}
		break;
	}
}

void ASIStorm::Tick(float Dt)
{
	Super::Tick(Dt);
	PhaseLeft -= Dt;
	switch (Phase)
	{
	case EStormPhase::Calm:
		if (PhaseLeft <= 0.f)
		{
			Phase = EStormPhase::Warning;
			PhaseLeft = WarningTime;
			StartStorm();
		}
		break;
	case EStormPhase::Warning:
		// The wall stands on the horizon, growing as it gathers.
		Clock += Dt;
		Wall->SetWorldLocation(FVector(Pos, -3000.f));
		Wall->SetWorldScale3D(FVector(R, R, WallHeight * (1.f - PhaseLeft / WarningTime * 0.6f)));
		Wall->SetWorldRotation(FRotator(0.f, Clock * 3.f, 0.f));
		InnerWall->SetWorldLocation(FVector(Pos, -3000.f));
		InnerWall->SetWorldScale3D(FVector(R * 0.97f, R * 0.97f, WallHeight * 0.8f * (1.f - PhaseLeft / WarningTime * 0.6f)));
		if (PhaseLeft <= 0.f)
		{
			Phase = EStormPhase::Raging;
			PhaseLeft = Journey / Speed;
		}
		break;
	case EStormPhase::Raging:
		TickRaging(Dt);
		break;
	}
	TickWraiths(Dt);

	if (BoltTime > 0.f)
	{
		BoltTime -= Dt;
		if (BoltTime <= 0.f)
		{
			Bolt->SetVisibility(false);
		}
	}
	Flash->SetIntensity(FMath::Max(Flash->Intensity - Dt * 8.0e6f, 0.f));

	// How deep into the storm's darkness the player is.
	if (World)
	{
		float Gloom = 0.f;
		if (const APawn* Player = UGameplayStatics::GetPlayerPawn(this, 0); Player && Phase == EStormPhase::Raging)
		{
			const float D = FVector2D::Distance(FVector2D(Player->GetActorLocation()), Pos);
			Gloom = 1.f - FMath::SmoothStep(R - 2000.f, R + 5000.f, D);
			if (Protected(Player->GetActorLocation()))
			{
				Gloom *= 0.3f;
			}
		}
		World->StormGloom = Gloom;
	}
}

void ASIStorm::DebugStartNear()
{
	StartStorm();
	Phase = EStormPhase::Raging;
	// Move it on until the player stands a little way inside its leading edge.
	const float Skip = Margin + 4000.f;
	Pos += Dir * Skip;
	Travelled = Skip;
	PhaseLeft = (Journey - Travelled) / Speed;
	SpawnTimer = 2.f;
}
