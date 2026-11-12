#include "DragonPawn.h"
#include "DragonWorld.h"
#include "Camera/CameraComponent.h"
#include "Components/PoseableMeshComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/PointLightComponent.h"
#include "Materials/MaterialInterface.h"
#include "Components/SphereComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "InputCoreTypes.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Kismet/GameplayStatics.h"
#include "ReferenceSkeleton.h"
#include "UObject/ConstructorHelpers.h"

ADragonPawn::ADragonPawn()
{
	PrimaryActorTick.bCanEverTick = true;
	AutoPossessPlayer = EAutoReceiveInput::Disabled;

	Body = CreateDefaultSubobject<USphereComponent>(TEXT("Body"));
	Body->InitSphereRadius(250.f);
	Body->SetCollisionProfileName(TEXT("Pawn"));
	RootComponent = Body;

	Mesh = CreateDefaultSubobject<UPoseableMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(Body);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	// Made by Tools/setup_assets.py from SourceArt/dragon.fbx.
	static ConstructorHelpers::FObjectFinder<USkeletalMesh> DragonMesh(TEXT("/Game/Dragon/SK_Dragon.SK_Dragon"));
	DragonAsset = DragonMesh.Object;

	// Shown only while the dragon model has not been imported yet.
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
	Arm->TargetArmLength = 2000.f;
	Arm->SocketOffset = FVector(0.f, 0.f, 450.f);
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
	if (DragonAsset)
	{
		Mesh->SetSkinnedAssetAndUpdate(DragonAsset);
	}
	Speed = CruiseSpeed;
	CacheBones();

	if (UMaterialInterface* Fire = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_Fire.M_Fire"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		Flames->SetMaterial(0, Fire);
	}
	Flames->SetNumCustomDataFloats(1);
	FlamePool.SetNum(420);
	const FTransform Hidden(FRotator::ZeroRotator, GetActorLocation(), FVector(0.001f));
	for (int32 i = 0; i < FlamePool.Num(); ++i)
	{
		Flames->AddInstance(Hidden, true);
	}
	FireLight->SetRelativeLocation(MouthOffset + FVector(1500.f, 0.f, 0.f));
}

void ADragonPawn::Boost()
{
	Speed = FMath::Min(Speed + 1800.f, MaxSpeed);
}

void ADragonPawn::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	const float Dt = FMath::Min(DeltaSeconds, 0.05f);
	Clock += Dt;

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
	UpdateFire(Dt, bFire || bAutoFire);
	AnimateBody(Dt, bFlap);
}

FVector ADragonPawn::GetMouthLocation() const
{
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

void ADragonPawn::CacheBones()
{
	Bones.Reset();
	USkinnedAsset* Asset = Mesh->GetSkinnedAsset();
	if (!Asset)
	{
		return;
	}
	const FReferenceSkeleton& Skel = Asset->GetRefSkeleton();
	const TArray<FTransform>& Local = Skel.GetRefBonePose();
	TArray<FTransform> Comp;
	Comp.SetNum(Local.Num());
	for (int32 i = 0; i < Local.Num(); ++i)
	{
		const int32 Parent = Skel.GetParentIndex(i);
		Comp[i] = Parent >= 0 ? Local[i] * Comp[Parent] : Local[i];
		FBoneRef Ref;
		Ref.Index = i;
		Ref.LocalRef = Local[i].GetRotation();
		Ref.ParentRefComp = Parent >= 0 ? Comp[Parent].GetRotation() : FQuat::Identity;
		Ref.Side = Comp[i].GetLocation().Y >= 0.f ? 1.f : -1.f;
		Bones.Add(Skel.GetBoneName(i), Ref);
	}
}

float ADragonPawn::SideOf(FName Bone) const
{
	const FBoneRef* Ref = Bones.Find(Bone);
	return Ref ? Ref->Side : 1.f;
}

void ADragonPawn::TurnBone(FName Bone, const FQuat& Delta)
{
	const FBoneRef* Ref = Bones.Find(Bone);
	if (Ref && Mesh->BoneSpaceTransforms.IsValidIndex(Ref->Index))
	{
		const FQuat Q = Ref->ParentRefComp.Inverse() * Delta * Ref->ParentRefComp * Ref->LocalRef;
		Mesh->BoneSpaceTransforms[Ref->Index].SetRotation(Q.GetNormalized());
	}
}

void ADragonPawn::AnimateBody(float Dt, bool bFlapping)
{
	// Strong, fast beats while flapping; a slow shallow beat while gliding; wings swept back in a dive.
	const float TargetFold = FMath::Clamp((-Pitch - 20.f) / 40.f, 0.f, 1.f);
	Fold = FMath::FInterpTo(Fold, bFlapping ? 0.f : TargetFold, Dt, 3.f);
	FlapAmount = FMath::FInterpTo(FlapAmount, bFlapping ? 1.f : 0.28f * (1.f - Fold), Dt, 4.f);
	FlapPhase += Dt * 2.f * PI * FMath::Lerp(0.55f, 1.7f, FlapAmount);
	if (FlapPhase > 2.f * PI)
	{
		FlapPhase -= 2.f * PI;
	}

	Mesh->SetRelativeLocation(FVector(0.f, 0.f, -FMath::Sin(FlapPhase) * 35.f * FlapAmount));
	if (Bones.Num() == 0)
	{
		return;
	}

	const FVector X = FVector::ForwardVector, Y = FVector::RightVector, Z = FVector::UpVector;
	auto Rad = [](float Deg) { return FMath::DegreesToRadians(Deg); };
	const float Turn = FMath::Clamp(TurnRate / TurnSpeed, -1.f, 1.f);

	// Wings. Turning about X lifts the tip, turning about Z sweeps it back; both mirror by side.
	const TCHAR* Sides[] = { TEXT("l"), TEXT("r") };
	for (const TCHAR* S : Sides)
	{
		const FName Upper(*FString::Printf(TEXT("wing_upper_%s"), S));
		const FName Fore(*FString::Printf(TEXT("wing_fore_%s"), S));
		const float Side = SideOf(Upper);
		const float Up = FMath::Sin(FlapPhase) * 36.f * FlapAmount + 8.f;
		const float ForeUp = FMath::Sin(FlapPhase - 0.7f) * 22.f * FlapAmount;
		const float TipUp = FMath::Sin(FlapPhase - 1.3f) * 14.f * FlapAmount;
		TurnBone(Upper, FQuat(Z, Rad(30.f * Fold) * Side) * FQuat(X, Rad(Up) * Side));
		TurnBone(Fore, FQuat(Z, Rad(35.f * Fold) * Side) * FQuat(X, Rad(ForeUp) * Side));
		for (int32 i = 1; i <= 3; ++i)
		{
			TurnBone(FName(*FString::Printf(TEXT("finger%d_%s"), i, S)), FQuat(Z, Rad(8.f * i * Fold) * Side) * FQuat(X, Rad(TipUp) * Side));
		}
	}

	// Neck and head look into the turn and level out against the body's pitch a little.
	for (const TCHAR* Name : { TEXT("neck1"), TEXT("neck2"), TEXT("neck3"), TEXT("head") })
	{
		TurnBone(FName(Name), FQuat(Z, Rad(9.f * Turn)) * FQuat(Y, Rad(FMath::Sin(FlapPhase + 1.f) * 1.5f * FlapAmount)));
	}

	// Tail trails behind: swings away from the turn and waves gently.
	for (int32 i = 1; i <= 6; ++i)
	{
		const float Wave = FMath::Sin(Clock * 1.6f - i * 0.55f) * 3.5f;
		const float Beat = FMath::Sin(FlapPhase - 0.4f * i) * 2.5f * FlapAmount;
		TurnBone(FName(*FString::Printf(TEXT("tail%d"), i)), FQuat(Z, Rad(Wave + 7.f * Turn)) * FQuat(Y, Rad(Beat)));
	}

	// Legs tucked back against the body.
	for (const TCHAR* S : Sides)
	{
		TurnBone(FName(*FString::Printf(TEXT("leg_f_upper_%s"), S)), FQuat(Y, Rad(35.f)));
		TurnBone(FName(*FString::Printf(TEXT("leg_r_upper_%s"), S)), FQuat(Y, Rad(40.f)));
	}

	Mesh->MarkRefreshTransformDirty();
}
