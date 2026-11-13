#include "SIEnemy.h"
#include "SIAnimInstance.h"
#include "SICharacter.h"
#include "SIResources.h"
#include "SIStorm.h"
#include "SIUtil.h"
#include "SIWorld.h"
#include "AIController.h"
#include "Animation/AnimSequenceBase.h"
#include "Components/CapsuleComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	UAnimSequenceBase* Anim(const TCHAR* Path)
	{
		return LoadObject<UAnimSequenceBase>(nullptr, *FString::Printf(TEXT("/Game/Characters/Mannequins/Anims/%s"), Path), nullptr, LOAD_NoWarn | LOAD_Quiet);
	}
}

ASIEnemy::ASIEnemy()
{
	PrimaryActorTick.bCanEverTick = true;
	AIControllerClass = AAIController::StaticClass();
	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
	GetCapsuleComponent()->InitCapsuleSize(40.f, 92.f);
	bUseControllerRotationYaw = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 420.f, 0.f);
	Move->MaxWalkSpeed = 390.f;
	Move->SetWalkableFloorAngle(50.f);
	GetMesh()->SetRelativeLocation(FVector(0.f, 0.f, -92.f));
	GetMesh()->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));

	Glow = CreateDefaultSubobject<UPointLightComponent>(TEXT("Glow"));
	Glow->SetupAttachment(RootComponent);
	Glow->SetRelativeLocation(FVector(0, 0, 40.f));
	Glow->SetLightColor(FLinearColor(0.55f, 0.2f, 1.f));
	Glow->SetIntensity(2500.f);
	Glow->SetAttenuationRadius(500.f);
	Glow->SetCastShadows(false);
}

void ASIEnemy::BeginPlay()
{
	Super::BeginPlay();
	USkeletalMeshComponent* Body = GetMesh();
	if (USkeletalMesh* M = LoadObject<USkeletalMesh>(nullptr, TEXT("/Game/Characters/Mannequins/Meshes/SKM_Quinn_Simple.SKM_Quinn_Simple"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		Body->SetSkeletalMesh(M);
	}
	for (int32 i = 0; i < Body->GetNumMaterials(); ++i)
	{
		Body->SetMaterial(i, Isle::Tinted(TEXT("M_Wraith"), FLinearColor(0.55f, 0.15f, 1.f), this));
	}
	Body->SetAnimInstanceClass(USIAnimInstance::StaticClass());
	if (USIAnimInstance* A = Cast<USIAnimInstance>(Body->GetAnimInstance()))
	{
		A->JogSpeed = 390.f;
	}
	for (const TCHAR* S : { TEXT("Unarmed/Attack/MM_Attack_01.MM_Attack_01"), TEXT("Unarmed/Attack/MM_Attack_02.MM_Attack_02") })
	{
		if (UAnimSequenceBase* A = Anim(S))
		{
			Swings.Add(A);
		}
	}
	Death = Anim(TEXT("Death/MM_Death_Back_01.MM_Death_Back_01"));
	SetActorScale3D(FVector(FMath::FRandRange(0.95f, 1.12f)));
	Wander = FMath::FRandRange(0.f, 3.f);
}

void ASIEnemy::Hurt(float Amount, const FVector& From)
{
	if (IsDead())
	{
		return;
	}
	Health -= Amount;
	Stagger = 0.35f;
	LaunchCharacter((GetActorLocation() - From).GetSafeNormal2D() * 420.f + FVector(0, 0, 120.f), true, false);
	if (Health <= 0.f)
	{
		DeadTime = 0.f;
		GetCharacterMovement()->DisableMovement();
		GetCapsuleComponent()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		if (USIAnimInstance* A = Cast<USIAnimInstance>(GetMesh()->GetAnimInstance()))
		{
			A->PlayAction(Death, 1.2f, true);
		}
		// Every other wraith or so leaves a crystal behind.
		if (FMath::FRand() < 0.5f)
		{
			if (TActorIterator<ASIResources> It(GetWorld()); It)
			{
				It->SpawnCrystal(GetActorLocation() + FVector(FMath::FRandRange(-80.f, 80.f), FMath::FRandRange(-80.f, 80.f), 0.f));
			}
		}
	}
}

void ASIEnemy::Tick(float Dt)
{
	Super::Tick(Dt);
	USIAnimInstance* A = Cast<USIAnimInstance>(GetMesh()->GetAnimInstance());
	if (A)
	{
		A->Speed = GetVelocity().Size2D();
		A->bInAir = GetCharacterMovement()->IsFalling() && GetVelocity().Z < -200.f;
	}
	if (IsDead())
	{
		// Lie still a moment, then sink into the ground and go.
		DeadTime += Dt;
		Glow->SetIntensity(FMath::Max(2500.f * (1.f - DeadTime), 0.f));
		if (DeadTime > 2.f)
		{
			AddActorWorldOffset(FVector(0, 0, -60.f * Dt));
		}
		if (DeadTime > 4.f)
		{
			Destroy();
		}
		return;
	}

	ASICharacter* Player = Cast<ASICharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	ASIStorm* Storm = TActorIterator<ASIStorm>(GetWorld()) ? *TActorIterator<ASIStorm>(GetWorld()) : nullptr;
	ASIWorld* World = TActorIterator<ASIWorld>(GetWorld()) ? *TActorIterator<ASIWorld>(GetWorld()) : nullptr;
	const FVector Here = GetActorLocation();

	// Daylight outside the storm burns wraiths away.
	const bool bShielded = (Storm && Storm->IsInside(Here)) || (World && World->IsNight());
	if (!bShielded)
	{
		Sun += Dt;
		if (Sun > 1.f)
		{
			Sun = 0.f;
			Hurt(15.f, Here + GetActorForwardVector() * 10.f);
			return;
		}
	}
	Glow->SetIntensity(2500.f + 900.f * FMath::Sin(GetGameTimeSinceCreation() * 6.f));

	Stagger -= Dt;
	Cooldown -= Dt;
	if (AttackTimer >= 0.f)
	{
		AttackTimer -= Dt;
		if (AttackTimer < 0.f && Player && !Player->IsDead())
		{
			const FVector To = Player->GetActorLocation() - Here;
			if (To.Size2D() < 210.f && FMath::Abs(To.Z) < 200.f)
			{
				Player->Hurt(11.f, Here);
			}
		}
		return;
	}
	if (Stagger > 0.f)
	{
		return;
	}

	if (Player && !Player->IsDead())
	{
		const FVector To = Player->GetActorLocation() - Here;
		const float Dist = To.Size2D();
		if (Dist < 5000.f)
		{
			if (Dist < 160.f && Cooldown <= 0.f && A && !Swings.IsEmpty())
			{
				SetActorRotation(FRotator(0.f, To.Rotation().Yaw, 0.f));
				A->PlayAction(Swings[FMath::RandRange(0, Swings.Num() - 1)], 1.1f);
				AttackTimer = 0.42f;
				Cooldown = 1.6f;
				return;
			}
			if (Dist > 130.f)
			{
				// Close in with a slight weave, so a pack does not walk in single file.
				const FVector Side = FVector::CrossProduct(To.GetSafeNormal2D(), FVector::UpVector);
				const float Weave = FMath::Sin(GetGameTimeSinceCreation() * 1.3f + Wander) * FMath::Clamp(Dist / 1500.f, 0.f, 0.6f);
				AddMovementInput((To.GetSafeNormal2D() + Side * Weave).GetSafeNormal(), 1.f);
			}
			return;
		}
	}

	// Nothing to hunt: drift about.
	Wander -= Dt;
	if (Wander < 0.f)
	{
		Wander = FMath::FRandRange(2.f, 5.f);
		WanderDir = FRotator(0.f, FMath::FRandRange(0.f, 360.f), 0.f).Vector();
	}
	AddMovementInput(WanderDir, 0.4f);
}
