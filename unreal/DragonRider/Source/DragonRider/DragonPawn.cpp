#include "DragonPawn.h"
#include "DragonAnimInstance.h"
#include "DragonWorld.h"
#include "Animation/AnimSequence.h"
#include "Animation/AnimSingleNodeInstance.h"
#include "Camera/CameraComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "ReferenceSkeleton.h"
#include "UObject/ConstructorHelpers.h"

namespace
{
	// The Sakura Dragon asset faces +Y, and its flight animation carries the body about 3 m above
	// the asset's origin. This point, the middle of the chest while flying, is what the pawn flies around.
	const FVector DragonCentre(0.f, 300.f, 560.f);
	// Where the rider sits, in the asset's own space: on the back between the wings.
	const FVector SaddlePoint(0.f, 335.f, 318.f);
	const FName SaddleBone(TEXT("spine_02"));
}

ADragonPawn::ADragonPawn()
{
	PrimaryActorTick.bCanEverTick = true;

	Body = CreateDefaultSubobject<USphereComponent>(TEXT("Body"));
	Body->InitSphereRadius(250.f);
	Body->SetCollisionProfileName(TEXT("Pawn"));
	RootComponent = Body;

	Mesh = CreateDefaultSubobject<USkeletalMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(Body);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	static ConstructorHelpers::FObjectFinder<USkeletalMesh> DragonMesh(TEXT("/Game/SakuraDragon/Meshes/SK_Dragon_Sakura.SK_Dragon_Sakura"));
	static ConstructorHelpers::FObjectFinder<UAnimSequence> Fly(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Fly_Forward.A_Sakura_Fly_Forward"));
	if (DragonMesh.Succeeded())
	{
		Mesh->SetSkeletalMeshAsset(DragonMesh.Object);
	}
	FlyAnim = Fly.Object;

	Rider = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Rider"));
	Rider->SetupAttachment(Mesh);
	Rider->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> RiderMesh(TEXT("/Game/Rider/SM_Rider.SM_Rider"));
	if (RiderMesh.Succeeded())
	{
		Rider->SetStaticMesh(RiderMesh.Object);
	}

	// Shown only when the dragon asset is not in the project.
	Placeholder = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Placeholder"));
	Placeholder->SetupAttachment(Body);
	Placeholder->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Cone(TEXT("/Engine/BasicShapes/Cone.Cone"));
	if (Cone.Succeeded())
	{
		Placeholder->SetStaticMesh(Cone.Object);
	}
	Placeholder->SetRelativeRotation(FRotator(-90.f, 0.f, 0.f));
	Placeholder->SetRelativeScale3D(FVector(3.f, 3.f, 8.f));
	Placeholder->SetVisibility(!DragonMesh.Succeeded());

	Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("Arm"));
	Arm->SetupAttachment(Body);
	Arm->TargetArmLength = 2200.f;
	Arm->SocketOffset = FVector(0.f, 0.f, 550.f);
	Arm->bDoCollisionTest = false;
	Arm->bInheritRoll = false;
	Arm->bEnableCameraLag = true;
	Arm->CameraLagSpeed = 5.f;
	Arm->bEnableCameraRotationLag = true;
	Arm->CameraRotationLagSpeed = 5.f;

	// Flames are spheres drawn in one batch; each carries its heat (1 fresh, 0 burnt out) to the material.
	Flames = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Flames"));
	Flames->SetupAttachment(Body);
	Flames->SetUsingAbsoluteLocation(true);
	Flames->SetUsingAbsoluteRotation(true);
	Flames->SetUsingAbsoluteScale(true);
	Flames->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Flames->SetCastShadow(false);
	static ConstructorHelpers::FObjectFinder<UStaticMesh> Ball(TEXT("/Engine/BasicShapes/Sphere.Sphere"));
	if (Ball.Succeeded())
	{
		Flames->SetStaticMesh(Ball.Object);
	}

	FireLight = CreateDefaultSubobject<UPointLightComponent>(TEXT("FireLight"));
	FireLight->SetupAttachment(Body);
	FireLight->SetIntensityUnits(ELightUnits::Candelas);
	FireLight->SetIntensity(0.f);
	FireLight->SetLightColor(FLinearColor(1.f, 0.45f, 0.1f));
	FireLight->SetAttenuationRadius(9000.f);
	FireLight->SetCastShadows(false);

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Arm);
	Camera->SetRelativeRotation(FRotator(-8.f, 0.f, 0.f));
	Camera->SetFieldOfView(85.f);
	// Hold the exposure a little down so sunlit ground and the dragon keep their colour.
	Camera->PostProcessSettings.bOverride_AutoExposureBias = true;
	Camera->PostProcessSettings.AutoExposureBias = -0.5f;
}

void ADragonPawn::BeginPlay()
{
	Super::BeginPlay();
	SetActorLocationAndRotation(ADragonWorld::StartLocation(), FRotator::ZeroRotator);
	Speed = CruiseSpeed;

	// Turn the asset to face forward and put the middle of its chest on the pawn's centre.
	const FRotator Facing(0.f, -90.f, 0.f);
	MeshRestLocation = -Facing.RotateVector(DragonCentre) * DragonScale;
	Mesh->SetRelativeTransform(FTransform(Facing, MeshRestLocation, FVector(DragonScale)));
	if (FlyAnim && Mesh->GetSkeletalMeshAsset())
	{
		// Our own single-animation player, which can also open the jaw (see DragonAnimInstance.h).
		Mesh->SetAnimInstanceClass(UDragonAnimInstance::StaticClass());
		if (UDragonAnimInstance* Anim = Cast<UDragonAnimInstance>(Mesh->GetAnimInstance()))
		{
			Anim->SetAnimationAsset(FlyAnim, true);
			Anim->SetPlaying(true);
		}
	}

	// Recolour: the asset's materials multiply their colour by BaseTint and their glow by EmissiveTint.
	for (int32 i = 0; i < Mesh->GetNumMaterials(); ++i)
	{
		if (UMaterialInstanceDynamic* M = Mesh->CreateDynamicMaterialInstance(i))
		{
			const bool bWing = Mesh->GetMaterialSlotNames().IsValidIndex(i) && Mesh->GetMaterialSlotNames()[i].ToString().Contains(TEXT("Wing"));
			M->SetVectorParameterValue(TEXT("BaseTint"), bWing ? WingTint : BodyTint);
			M->SetVectorParameterValue(TEXT("EmissiveTint"), GlowTint);
		}
	}
	SeatRider();

	// Starting the game with -View=N opens in that camera view (see SetView), for checking the model.
	int32 StartView = 0;
	FParse::Value(FCommandLine::Get(), TEXT("View="), StartView);
	SetView(StartView);

	if (UMaterialInterface* Fire = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_Fire.M_Fire"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		Flames->SetMaterial(0, Fire);
	}
	Flames->SetNumCustomDataFloats(1);
	FlamePool.SetNum(1400);
	const FTransform Hidden(FRotator::ZeroRotator, GetActorLocation(), FVector(0.001f));
	for (int32 i = 0; i < FlamePool.Num(); ++i)
	{
		Flames->AddInstance(Hidden, true);
	}
	FireLight->SetRelativeLocation(MouthOffset + FVector(1500.f, 0.f, 0.f));
}

void ADragonPawn::SeatRider()
{
	USkeletalMesh* Asset = Mesh->GetSkeletalMeshAsset();
	if (!Asset || !Rider->GetStaticMesh())
	{
		Rider->SetVisibility(false);
		return;
	}
	// The seat is given in the dragon's rest pose; riding on a spine bone makes the rider
	// rise and fall with the wingbeat instead of floating at a fixed spot.
	const FReferenceSkeleton& Skel = Asset->GetRefSkeleton();
	const int32 Bone = Skel.FindBoneIndex(SaddleBone);
	if (Bone == INDEX_NONE)
	{
		Rider->SetRelativeLocation(SaddlePoint);
		return;
	}
	FTransform BoneRest = FTransform::Identity;
	for (int32 i = Bone; i != INDEX_NONE; i = Skel.GetParentIndex(i))
	{
		BoneRest = BoneRest * Skel.GetRefBonePose()[i];
	}
	// The rider model faces +X and has its origin at the hips; the dragon faces +Y.
	const FTransform Seat(FRotator(0.f, 90.f, 0.f), SaddlePoint, FVector(1.f / DragonScale));
	Rider->AttachToComponent(Mesh, FAttachmentTransformRules::KeepRelativeTransform, SaddleBone);
	Rider->SetRelativeTransform(Seat.GetRelativeTransform(BoneRest));
}

void ADragonPawn::SetView(int32 NewView)
{
	struct FViewSetup
	{
		const TCHAR* Name;
		FVector Pivot;      // where the camera arm starts, relative to the dragon's centre
		float Yaw;          // 0 looks forward from behind, 180 looks back at the dragon's face
		float Length;
		float Lift;         // how far above the arm's end the camera sits
		float Tilt;         // camera pitch
		bool bLag;          // trail behind smoothly (only suits views from behind)
		bool bHideRider;
	};
	static const FViewSetup Views[] = {
		{ TEXT("CHASE"),       FVector(0.f, 0.f, 0.f),     0.f,   2200.f, 550.f,  -8.f, true,  false },
		{ TEXT("FAR CHASE"),   FVector(0.f, 0.f, 0.f),     0.f,   4600.f, 1300.f, -10.f, true, false },
		{ TEXT("RIDER"),       FVector(40.f, 0.f, 310.f),  0.f,   0.f,    0.f,    -6.f, false, true  },
		{ TEXT("FRONT"),       FVector(560.f, 0.f, 150.f), 160.f, 1500.f, 0.f,    0.f,  false, false },
		{ TEXT("SIDE"),        FVector(0.f, 0.f, 100.f),   90.f,  3000.f, 0.f,    0.f,  false, false },
		{ TEXT("FROM ABOVE"),  FVector(0.f, 0.f, 0.f),     0.f,   600.f,  3800.f, -72.f, false, false },
	};
	View = ((NewView % UE_ARRAY_COUNT(Views)) + UE_ARRAY_COUNT(Views)) % UE_ARRAY_COUNT(Views);
	const FViewSetup& V = Views[View];
	ViewName = V.Name;
	Arm->SetRelativeLocation(V.Pivot);
	Arm->SetRelativeRotation(FRotator(0.f, V.Yaw, 0.f));
	Arm->TargetArmLength = V.Length;
	Arm->SocketOffset = FVector(0.f, 0.f, V.Lift);
	Arm->bEnableCameraLag = V.bLag;
	Arm->bEnableCameraRotationLag = V.bLag;
	Camera->SetRelativeRotation(FRotator(V.Tilt, 0.f, 0.f));
	Rider->SetVisibility(!V.bHideRider && Rider->GetStaticMesh() != nullptr && Mesh->GetSkeletalMeshAsset() != nullptr);
}

void ADragonPawn::FlamePuff(const FVector& Location, const FVector& Velocity, float Life)
{
	EmitFlame(Location, Velocity, Life);
}

void ADragonPawn::Boost()
{
	Speed = FMath::Min(Speed + 1800.f, MaxSpeed);
}

void ADragonPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);

	// ---- input, read directly so the project needs no input assets ----
	float TurnIn = 0.f, PitchIn = 0.f, MouseX = 0.f, MouseY = 0.f;
	bool bFlap = false, bBrake = false, bFire = false;
	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		TurnIn = (PC->IsInputKeyDown(EKeys::D) ? 1.f : 0.f) - (PC->IsInputKeyDown(EKeys::A) ? 1.f : 0.f)
			+ PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX);
		// S or pulling the stick back raises the nose, as on a flight stick.
		PitchIn = (PC->IsInputKeyDown(EKeys::S) ? 1.f : 0.f) - (PC->IsInputKeyDown(EKeys::W) ? 1.f : 0.f)
			- PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftY);
		PC->GetInputMouseDelta(MouseX, MouseY);
		bFlap = PC->IsInputKeyDown(EKeys::SpaceBar) || PC->IsInputKeyDown(EKeys::LeftMouseButton)
			|| PC->IsInputKeyDown(EKeys::Gamepad_FaceButton_Bottom);
		bBrake = PC->IsInputKeyDown(EKeys::LeftShift) || PC->IsInputKeyDown(EKeys::Gamepad_LeftTrigger);
		bFire = PC->IsInputKeyDown(EKeys::F) || PC->IsInputKeyDown(EKeys::RightMouseButton)
			|| PC->IsInputKeyDown(EKeys::Gamepad_RightTrigger);
		if (PC->WasInputKeyJustPressed(EKeys::Escape))
		{
			UKismetSystemLibrary::QuitGame(this, PC, EQuitPreference::Quit, false);
			return;
		}
		if (PC->WasInputKeyJustPressed(EKeys::C) || PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Top))
		{
			SetView(View + 1);
		}
		if (PC->WasInputKeyJustPressed(EKeys::R) || PC->WasInputKeyJustPressed(EKeys::Gamepad_Special_Right))
		{
			UGameplayStatics::OpenLevel(this, FName(*UGameplayStatics::GetCurrentLevelName(this)));
			return;
		}
	}
	TurnIn = FMath::Clamp(TurnIn, -1.f, 1.f);
	PitchIn = FMath::Clamp(PitchIn, -1.f, 1.f);

	// ---- leaving the map: steer back towards the middle ----
	const FVector Loc = GetActorLocation();
	bTurningBack = FVector2D(Loc.X, Loc.Y).Size() > ADragonWorld::PlayRadius;
	if (bTurningBack)
	{
		const float Home = FVector(-Loc.X, -Loc.Y, 0.f).Rotation().Yaw;
		TurnIn = FMath::Clamp(FMath::FindDeltaAngleDegrees(Yaw, Home) / 30.f, -1.f, 1.f);
		MouseX = 0.f;
	}

	// ---- steering ----
	TurnRate = FMath::FInterpTo(TurnRate, TurnIn * TurnSpeed, Dt, 3.f);
	const float MouseYaw = MouseX * MouseSensitivity;
	Yaw = FRotator::NormalizeAxis(Yaw + TurnRate * Dt + MouseYaw);
	Pitch += PitchIn * PitchSpeed * Dt + MouseY * MouseSensitivity;
	if (Speed < MinSpeed * 1.6f)
	{
		Pitch -= 25.f * Dt; // too slow to stay up: the nose drops until speed returns
	}
	Pitch = FMath::Clamp(Pitch, -75.f, 70.f);
	const float RollTarget = FMath::Clamp(TurnRate / TurnSpeed * 48.f + MouseYaw / FMath::Max(Dt, 0.001f) * 0.25f, -65.f, 65.f);
	Roll = FMath::FInterpTo(Roll, RollTarget, Dt, 4.f);

	// ---- speed ----
	const float SinPitch = FMath::Sin(FMath::DegreesToRadians(Pitch));
	Speed += -SinPitch * 2200.f * Dt;               // diving gains speed, climbing loses it
	Speed += (CruiseSpeed - Speed) * 0.10f * Dt;    // drifts back to cruising speed
	if (bFlap)
	{
		Speed += FlapThrust * Dt;
	}
	if (bBrake)
	{
		Speed -= 3000.f * Dt;
	}
	Speed = FMath::Clamp(Speed, MinSpeed, MaxSpeed);

	// ---- move, sliding along whatever is hit ----
	const FVector Step = FRotator(Pitch, Yaw, 0.f).Vector() * Speed * Dt;
	FHitResult Hit;
	AddActorWorldOffset(Step, true, &Hit);
	if (Hit.bBlockingHit)
	{
		const FVector Rest = FVector::VectorPlaneProject(Step * (1.f - Hit.Time), Hit.Normal);
		AddActorWorldOffset(Rest + Hit.Normal * 5.f, true);
		Speed = FMath::Max(Speed * (1.f - 1.5f * Dt), MinSpeed);
		if (Hit.Normal.Z > 0.2f)
		{
			Pitch = FMath::FInterpTo(Pitch, 25.f, Dt, 5.f); // skim up off the ground or the sea
		}
	}
	SetActorRotation(FRotator(Pitch, Yaw, Roll));

	Camera->SetFieldOfView(FMath::FInterpTo(Camera->FieldOfView, 85.f + 22.f * FMath::Clamp((Speed - CruiseSpeed) / (MaxSpeed - CruiseSpeed), 0.f, 1.f), Dt, 3.f));

	// Starting the game with -AutoFire keeps the dragon breathing fire, for checking the effect unattended.
	static const bool bAutoFire = FParse::Param(FCommandLine::Get(), TEXT("AutoFire"));
	if (bAutoFire)
	{
		Fuel = 1.f;
	}
	UpdateFire(Dt, bFire || bAutoFire);
	// Wingbeat: quick and strong while flapping, slow and easy while gliding.
	FlapAmount = FMath::FInterpTo(FlapAmount, bFlap ? 1.f : 0.3f, Dt, 4.f);
	if (UDragonAnimInstance* Anim = Cast<UDragonAnimInstance>(Mesh->GetAnimInstance()))
	{
		Anim->SetPlayRate(FMath::Lerp(0.5f, 1.5f, FlapAmount));
		// The mouth opens quickly as the fire starts and eases shut afterwards.
		Anim->JawOpen = FMath::FInterpTo(Anim->JawOpen, bBreathing ? 1.f : 0.f, Dt, bBreathing ? 14.f : 5.f);
	}
}

FVector ADragonPawn::GetMouthLocation() const
{
	if (Mesh->GetSkeletalMeshAsset() && Mesh->GetBoneIndex(MouthBone) != INDEX_NONE)
	{
		return Mesh->GetSocketLocation(MouthBone);
	}
	return GetActorLocation() + GetActorRotation().RotateVector(MouthOffset);
}

FVector ADragonPawn::GetFireDirection() const
{
	return GetActorForwardVector();
}

void ADragonPawn::EmitFlame(const FVector& Pos, const FVector& Vel, float Life)
{
	if (FlamePool.Num() == 0)
	{
		return;
	}
	FFlame& F = FlamePool[NextFlame];
	NextFlame = (NextFlame + 1) % FlamePool.Num();
	F.Pos = Pos;
	F.Vel = Vel;
	F.Age = 0.f;
	F.Life = Life;
}

void ADragonPawn::FireBurst(const FVector& Location)
{
	for (int32 i = 0; i < 60; ++i)
	{
		EmitFlame(Location + FMath::VRand() * 200.f, FMath::VRand() * FMath::FRandRange(600.f, 2600.f), FMath::FRandRange(0.5f, 1.1f));
	}
}

void ADragonPawn::UpdateFire(float Dt, bool bWantsFire)
{
	// Once the fuel runs dry the dragon has to recover a fifth of it before breathing again.
	if (Fuel <= 0.f)
	{
		bFuelSpent = true;
	}
	else if (Fuel > 0.2f)
	{
		bFuelSpent = false;
	}
	bBreathing = bWantsFire && !bFuelSpent;
	Fuel = FMath::Clamp(Fuel + (bBreathing ? -Dt / FuelSeconds : Dt / RefuelSeconds), 0.f, 1.f);

	if (bBreathing)
	{
		const FVector Mouth = GetMouthLocation();
		const FVector Dir = GetFireDirection();
		const FVector Carry = Dir * Speed; // the flame starts with the dragon's own speed
		EmitDebt += 300.f * Dt;
		while (EmitDebt >= 1.f)
		{
			EmitDebt -= 1.f;
			const FVector Spread = FMath::VRand() * FMath::FRandRange(0.f, 750.f);
			EmitFlame(Mouth + Dir * FMath::FRandRange(0.f, 250.f), Carry + Dir * FMath::FRandRange(4500.f, 6500.f) + Spread, FMath::FRandRange(0.55f, 1.0f));
		}
	}
	else
	{
		EmitDebt = 0.f;
	}

	for (int32 i = 0; i < FlamePool.Num(); ++i)
	{
		FFlame& F = FlamePool[i];
		if (F.Life <= 0.f)
		{
			continue;
		}
		F.Age += Dt;
		float Scale = 0.001f, Heat = 0.f;
		if (F.Age >= F.Life)
		{
			F.Life = 0.f;
		}
		else
		{
			F.Vel *= FMath::Max(0.f, 1.f - 1.3f * Dt); // air drag
			F.Vel.Z += 600.f * Dt;                      // hot gas rises
			F.Pos += F.Vel * Dt;
			const float T = F.Age / F.Life;
			Scale = FMath::Lerp(0.6f, 5.5f, FMath::Pow(T, 0.7f)); // billows out from a narrow jet
			Heat = 1.f - T;
		}
		Flames->UpdateInstanceTransform(i, FTransform(FRotator::ZeroRotator, F.Pos, FVector(Scale)), true, false, true);
		Flames->SetCustomDataValue(i, 0, Heat, false);
	}
	Flames->MarkRenderStateDirty();

	const float Glow = bBreathing ? 4000.f * FMath::FRandRange(0.7f, 1.f) : 0.f;
	FireLight->SetIntensity(FMath::FInterpTo(FireLight->Intensity, Glow, Dt, 12.f));
}
