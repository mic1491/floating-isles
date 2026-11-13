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
	// The standing, walking and landing animations hold the chest this high above the asset's origin.
	const float GroundCentreZ = 250.f;
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
	auto Clip = [](const TCHAR* Path) { return ConstructorHelpers::FObjectFinder<UAnimSequence>(Path).Object; };
	HoverAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Fly_Hover.A_Sakura_Fly_Hover"));
	LandAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Land.A_Sakura_Land"));
	TakeoffAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Takeoff.A_Sakura_Takeoff"));
	IdleAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Idle.A_Sakura_Idle"));
	WalkAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Walk.A_Sakura_Walk"));
	RunAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Run.A_Sakura_Run"));
	RoarAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Roar.A_Sakura_Roar"));
	BreathAnim = Clip(TEXT("/Game/SakuraDragon/Animations/A_Sakura_Fire_Breath.A_Sakura_Fire_Breath"));

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
	Arm->bDoCollisionTest = true; // pulls the camera in rather than letting it sink into a hillside
	Arm->ProbeSize = 60.f;
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
		PlayAnim(FlyAnim, true);
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
	// Starting the game with -LandTest begins standing on the nearest flat ground, for checking the ground moves.
	if (FParse::Param(FCommandLine::Get(), TEXT("LandTest")))
	{
		for (float D = 0.f; D < 600000.f && Mode == EDragonMode::Flying; D += 2500.f)
		{
			for (float A = 0.f; A < 360.f; A += 15.f)
			{
				const FVector2D P = FVector2D(FMath::Cos(FMath::DegreesToRadians(A)), FMath::Sin(FMath::DegreesToRadians(A))) * D;
				const float H = ADragonWorld::HeightAt(P.X, P.Y);
				if (H > 2000.f && H < 12000.f && FMath::Abs(ADragonWorld::HeightAt(P.X + 1500.f, P.Y) - H) < 300.f && FMath::Abs(ADragonWorld::HeightAt(P.X, P.Y + 1500.f) - H) < 300.f)
				{
					PutOnGround(P);
					break;
				}
			}
		}
	}

	// The opening scene plays once per launch (not again on restart), and not in the test modes.
	static bool bIntroSeen = false;
	const TCHAR* Cmd = FCommandLine::Get();
	if (!bIntroSeen && Mode == EDragonMode::Flying && Mesh->GetSkeletalMeshAsset() && !FParse::Param(Cmd, TEXT("NoIntro"))
		&& !FParse::Param(Cmd, TEXT("AutoFire")) && !FParse::Param(Cmd, TEXT("BurnTest")) && !FCString::Strifind(Cmd, TEXT("View=")))
	{
		bIntroSeen = true;
		StartIntro();
	}

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
		{ TEXT("追尾"),       FVector(0.f, 0.f, 0.f),     0.f,   2200.f, 550.f,  -8.f, true,  false },
		{ TEXT("遠景追尾"),   FVector(0.f, 0.f, 0.f),     0.f,   4600.f, 1300.f, -10.f, true, false },
		{ TEXT("騎士"),       FVector(40.f, 0.f, 310.f),  0.f,   0.f,    0.f,    -6.f, false, true  },
		{ TEXT("正面"),       FVector(560.f, 0.f, 150.f), 160.f, 1500.f, 0.f,    0.f,  false, false },
		{ TEXT("側面"),        FVector(0.f, 0.f, 100.f),   90.f,  3000.f, 0.f,    0.f,  false, false },
		{ TEXT("俯視"),  FVector(0.f, 0.f, 0.f),     0.f,   600.f,  3800.f, -72.f, false, false },
	};
	View = ((NewView % UE_ARRAY_COUNT(Views)) + UE_ARRAY_COUNT(Views)) % UE_ARRAY_COUNT(Views);
	const FViewSetup& V = Views[View];
	ViewName = V.Name;
	ViewPivot = V.Pivot;
	Arm->SetRelativeLocation(ViewPivot - FVector(0.f, 0.f, BodyDrop));
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
		if (Mode == EDragonMode::Flying && (PC->WasInputKeyJustPressed(EKeys::G) || PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Left)))
		{
			TryLand();
		}
		if (PC->WasInputKeyJustPressed(EKeys::R) || PC->WasInputKeyJustPressed(EKeys::Gamepad_Special_Right))
		{
			UGameplayStatics::OpenLevel(this, FName(*UGameplayStatics::GetCurrentLevelName(this)));
			return;
		}
	}
	TurnIn = FMath::Clamp(TurnIn, -1.f, 1.f);
	PitchIn = FMath::Clamp(PitchIn, -1.f, 1.f);

	if (bIntro)
	{
		const APlayerController* PC = Cast<APlayerController>(GetController());
		TickIntro(Dt, bFlap || (PC && PC->WasInputKeyJustPressed(EKeys::Enter)));
		TurnIn = PitchIn = MouseX = MouseY = 0.f;
		bFlap = bBrake = bFire = false;
	}

	if (CutShot >= 0 && !bIntro)
	{
		// A story scene: the dragon flies itself, level and steady, while the camera holds the shot.
		CutTime += Dt;
		TurnIn = PitchIn = MouseX = MouseY = 0.f;
		bFlap = bBrake = bFire = false;
		if (Mode == EDragonMode::Flying)
		{
			Pitch = FMath::FInterpTo(Pitch, 0.f, Dt, 1.5f);
		}
		TickCutCamera();
	}

	NoticeTime -= Dt;
	if (NoticeTime <= 0.f)
	{
		Notice.Reset();
	}

	if (Mode != EDragonMode::Flying)
	{
		// On the ground W walks forward, Shift runs and Space takes off.
		TickGround(Dt, TurnIn, FMath::Max(-PitchIn, 0.f), MouseX, bBrake, bFlap);
	}
	else
	{
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
	}

	Arm->SetRelativeLocation(ViewPivot - FVector(0.f, 0.f, BodyDrop));
	if (bIntro && Mode == EDragonMode::Flying)
	{
		// The scene is over: hand the dragon and the usual camera to the player.
		bIntro = bIntroFire = false;
		SetView(View);
	}
	Camera->SetFieldOfView(FMath::FInterpTo(Camera->FieldOfView, 85.f + 22.f * FMath::Clamp((Speed - CruiseSpeed) / (MaxSpeed - CruiseSpeed), 0.f, 1.f), Dt, 3.f));

	// Starting the game with -AutoFire keeps the dragon breathing fire, for checking the effect unattended.
	static const bool bAutoFire = FParse::Param(FCommandLine::Get(), TEXT("AutoFire"));
	if (bAutoFire)
	{
		Fuel = 1.f;
	}
	if (bIntro)
	{
		Fuel = 1.f;
	}
	UpdateFire(Dt, (bFire || bAutoFire || bIntroFire) && (Mode == EDragonMode::Flying || Mode == EDragonMode::Grounded));
	// Wingbeat: quick and strong while flapping, slow and easy while gliding.
	FlapAmount = FMath::FInterpTo(FlapAmount, bFlap ? 1.f : 0.3f, Dt, 4.f);
	if (UDragonAnimInstance* Anim = Cast<UDragonAnimInstance>(Mesh->GetAnimInstance()))
	{
		if (Mode == EDragonMode::Flying)
		{
			Anim->SetPlayRate(FMath::Lerp(0.5f, 1.5f, FlapAmount));
		}
		// The mouth opens quickly as the fire starts and eases shut afterwards. Standing, the
		// breath animation already opens it, so only a little is added.
		const float Open = !bBreathing ? 0.f : Mode == EDragonMode::Flying ? 1.f : 0.35f;
		Anim->JawOpen = FMath::FInterpTo(Anim->JawOpen, Open, Dt, bBreathing ? 14.f : 5.f);
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
	// Standing, the flame goes out level and a little downward so it sweeps what is in front.
	return Mode == EDragonMode::Flying ? GetActorForwardVector() : FRotator(-5.f, Yaw, 0.f).Vector();
}

void ADragonPawn::PlayAnim(UAnimSequence* Clip, bool bLoop, float Rate)
{
	UDragonAnimInstance* Anim = Cast<UDragonAnimInstance>(Mesh->GetAnimInstance());
	if (!Anim || !Clip)
	{
		return;
	}
	if (Clip != CurrentAnim)
	{
		CurrentAnim = Clip;
		Anim->SetAnimationAsset(Clip, bLoop);
		Anim->SetPlaying(true);
	}
	Anim->SetPlayRate(Rate);
}

float ADragonPawn::StandHeight() const
{
	// The pawn's centre is the chest's flying height above the asset's origin, and the origin is where the feet stand.
	return DragonCentre.Z * DragonScale;
}

void ADragonPawn::AimCamera(const FVector& Pivot, float ArmYaw, float Length, float Lift, float Tilt)
{
	ViewPivot = Pivot;
	Arm->SetRelativeRotation(FRotator(0.f, ArmYaw, 0.f));
	Arm->TargetArmLength = Length;
	Arm->SocketOffset = FVector(0.f, 0.f, Lift);
	Arm->bEnableCameraLag = false;
	Arm->bEnableCameraRotationLag = false;
	Camera->SetRelativeRotation(FRotator(Tilt, 0.f, 0.f));
}

void ADragonPawn::SetCutsceneShot(int32 Shot)
{
	if (Shot == CutShot)
	{
		return;
	}
	CutShot = Shot;
	CutTime = 0.f;
	if (Shot < 0)
	{
		SetView(View);
	}
	else if (Shot == 0 && Mode == EDragonMode::Grounded)
	{
		PlayAnim(RoarAnim, false);
	}
}

void ADragonPawn::TickCutCamera()
{
	// Each shot drifts a little over its time so the picture is never frozen.
	const float T = CutTime;
	const bool bStanding = Mode != EDragonMode::Flying;
	switch (CutShot)
	{
	case 0: // the dragon's face, from just in front
		AimCamera(bStanding ? FVector(400.f, 0.f, 200.f) : FVector(480.f, 0.f, 120.f), 166.f - 5.f * T, 1150.f - 40.f * T, 0.f, 5.f);
		break;
	case 1: // from the side, swinging forward
		AimCamera(FVector(0.f, 0.f, 100.f), 72.f + 10.f * T, 2900.f, 200.f, -3.f);
		break;
	case 2: // low behind the tail, looking up along the body
		AimCamera(FVector(0.f, 0.f, 0.f), 22.f - 4.f * T, 2100.f, -260.f, 9.f);
		break;
	case 3: // high and far, taking in the islands
		AimCamera(FVector(0.f, 0.f, 0.f), 205.f + 7.f * T, 6800.f, 2300.f, -15.f);
		break;
	default: // over the rider's shoulder
		AimCamera(FVector(-160.f, 110.f, 330.f), 0.f, 360.f + 20.f * T, 0.f, -8.f);
		break;
	}
}

void ADragonPawn::StartIntro()
{
	// A flat shoulder high on a mountain, the nearest one to the middle of the map.
	for (float D = 20000.f; D < 700000.f; D += 3000.f)
	{
		for (float A = 0.f; A < 360.f; A += 12.f)
		{
			const FVector2D P = FVector2D(FMath::Cos(FMath::DegreesToRadians(A)), FMath::Sin(FMath::DegreesToRadians(A))) * D;
			const float H = ADragonWorld::HeightAt(P.X, P.Y);
			if (H > 30000.f && H < 80000.f && FMath::Abs(ADragonWorld::HeightAt(P.X + 1200.f, P.Y) - H) < 450.f && FMath::Abs(ADragonWorld::HeightAt(P.X, P.Y + 1200.f) - H) < 450.f)
			{
				Yaw = FVector(-P.X, -P.Y, 0.f).Rotation().Yaw; // looking out over the course
				PutOnGround(P);
				bIntro = true;
				IntroTime = 0.f;
				Rider->SetVisibility(Rider->GetStaticMesh() != nullptr);
				return;
			}
		}
	}
}

void ADragonPawn::TickIntro(float Dt, bool bSkip)
{
	// Shot list, in seconds from the start.
	const float RoarAt = 3.5f, FireAt = 6.6f, TakeoffAt = 9.4f;
	if (bSkip && IntroTime > 0.5f && IntroTime < TakeoffAt)
	{
		IntroTime = TakeoffAt;
	}
	IntroTime += Dt;
	const FVector Head(400.f, 0.f, 280.f); // the head when standing, relative to the pawn (before BodyDrop)
	bIntroFire = false;

	if (Mode == EDragonMode::Grounded)
	{
		if (IntroTime < RoarAt)
		{
			// Wide shot circling slowly in from far off.
			const float T = IntroTime / RoarAt;
			AimCamera(FVector(0.f, 0.f, 150.f), FMath::Lerp(235.f, 205.f, T), FMath::Lerp(7500.f, 5200.f, T), FMath::Lerp(1800.f, 900.f, T), -8.f);
			PlayAnim(IdleAnim, true);
		}
		else if (IntroTime < FireAt)
		{
			// Low and close under the jaw as it roars, the camera shaking with it.
			const float T = (IntroTime - RoarAt) / (FireAt - RoarAt);
			const float Shake = FMath::Sin(T * PI) * 14.f;
			AimCamera(Head + FVector(FMath::FRandRange(-Shake, Shake), FMath::FRandRange(-Shake, Shake), -160.f + FMath::FRandRange(-Shake, Shake)),
				FMath::Lerp(168.f, 150.f, T), FMath::Lerp(1050.f, 800.f, T), 0.f, 12.f);
			PlayAnim(RoarAnim ? RoarAnim.Get() : IdleAnim.Get(), false);
		}
		else if (IntroTime < TakeoffAt)
		{
			// From the side as it pours out fire.
			const float T = (IntroTime - FireAt) / (TakeoffAt - FireAt);
			AimCamera(FVector(350.f, 0.f, 200.f), FMath::Lerp(108.f, 84.f, T), 2700.f, 150.f, 0.f);
			bIntroFire = true;
		}
		else
		{
			Mode = EDragonMode::TakingOff;
			ModeTime = 0.f;
			PlayAnim(TakeoffAnim, false);
		}
	}
	if (Mode == EDragonMode::TakingOff)
	{
		// From behind and below as it leaps into the air.
		const float T = FMath::Clamp(ModeTime / 3.f, 0.f, 1.f);
		AimCamera(FVector(0.f, 0.f, 100.f), FMath::Lerp(28.f, 0.f, T), FMath::Lerp(1900.f, 2400.f, T), FMath::Lerp(-150.f, 450.f, T), FMath::Lerp(8.f, -6.f, T));
	}
}

void ADragonPawn::TryLand()
{
	const FVector Loc = GetActorLocation();
	const FVector Ahead = Loc + FRotator(0.f, Yaw, 0.f).Vector() * FMath::Clamp(Speed * 0.6f, 600.f, 2600.f);
	const float Ground = ADragonWorld::HeightAt(Ahead.X, Ahead.Y);
	NoticeTime = 3.f;
	if (Ground < 300.f)
	{
		Notice = TEXT("下方沒有陸地，請飛到島嶼上空再降落");
		return;
	}
	if (FMath::Abs(ADragonWorld::HeightAt(Ahead.X + 700.f, Ahead.Y) - Ground) > 450.f || FMath::Abs(ADragonWorld::HeightAt(Ahead.X, Ahead.Y + 700.f) - Ground) > 450.f)
	{
		Notice = TEXT("這裡太陡，無法降落");
		return;
	}
	Notice.Reset();
	Mode = EDragonMode::Descending;
	ModeTime = 0.f;
	LandFrom = Loc;
	LandTo = FVector(Ahead.X, Ahead.Y, Ground + StandHeight());
	LandDuration = FMath::Clamp(FVector::Dist(LandFrom, LandTo) / 2200.f, 1.2f, 8.f);
	PlayAnim(HoverAnim ? HoverAnim.Get() : FlyAnim.Get(), true);
}

void ADragonPawn::PutOnGround(const FVector2D& Where)
{
	Mode = EDragonMode::Grounded;
	ModeTime = 0.f;
	Speed = 0.f;
	Pitch = Roll = TurnRate = 0.f;
	BodyDrop = (DragonCentre.Z - GroundCentreZ) * DragonScale;
	SetActorLocationAndRotation(FVector(Where.X, Where.Y, ADragonWorld::HeightAt(Where.X, Where.Y) + StandHeight()), FRotator(0.f, Yaw, 0.f));
	PlayAnim(IdleAnim, true);
}

void ADragonPawn::TickGround(float Dt, float TurnIn, float Forward, float MouseX, bool bRun, bool bTakeOff)
{
	const float FullDrop = (DragonCentre.Z - GroundCentreZ) * DragonScale;
	ModeTime += Dt;
	FVector Loc = GetActorLocation();

	switch (Mode)
	{
	case EDragonMode::Descending:
	{
		// Glide down to the spot, levelling out and slowing as it comes in.
		const float A = FMath::SmoothStep(0.f, 1.f, ModeTime / LandDuration);
		Loc = FMath::Lerp(LandFrom, LandTo, A);
		Pitch = FMath::FInterpTo(Pitch, 0.f, Dt, 3.f);
		Roll = FMath::FInterpTo(Roll, 0.f, Dt, 3.f);
		Speed = FMath::FInterpTo(Speed, 0.f, Dt, 2.f);
		if (ModeTime >= LandDuration)
		{
			Mode = EDragonMode::Landing;
			ModeTime = 0.f;
			PlayAnim(LandAnim, false);
		}
		break;
	}
	case EDragonMode::Landing:
	{
		// The landing animation lowers the body to the ground by itself; the camera follows it down.
		const float Length = LandAnim ? LandAnim->GetPlayLength() : 1.f;
		BodyDrop = FullDrop * FMath::Clamp(ModeTime / Length, 0.f, 1.f);
		Pitch = Roll = Speed = 0.f;
		if (ModeTime >= Length)
		{
			Mode = EDragonMode::Grounded;
			ModeTime = 0.f;
			PlayAnim(IdleAnim, true);
		}
		break;
	}
	case EDragonMode::Grounded:
	{
		BodyDrop = FullDrop;
		Yaw = FRotator::NormalizeAxis(Yaw + TurnIn * 75.f * Dt + MouseX * MouseSensitivity);
		// It stands still to breathe fire; otherwise W walks and Shift makes it run.
		const float Pace = bBreathing ? 0.f : Forward * (bRun ? 2400.f : 750.f);
		if (Pace > 0.f)
		{
			const FVector Next = Loc + FRotator(0.f, Yaw, 0.f).Vector() * Pace * Dt;
			if (ADragonWorld::HeightAt(Next.X, Next.Y) > 150.f) // stops at the water's edge
			{
				Loc.X = Next.X;
				Loc.Y = Next.Y;
			}
		}
		Loc.Z = FMath::FInterpTo(Loc.Z, ADragonWorld::HeightAt(Loc.X, Loc.Y) + StandHeight(), Dt, 8.f);
		Speed = Pace;
		if (bBreathing && BreathAnim)
		{
			PlayAnim(BreathAnim, true);
		}
		else if (bIntro || CutShot >= 0)
		{
			// The opening and story scenes choose the animation themselves.
		}
		else if (Pace > 0.f)
		{
			PlayAnim(bRun ? RunAnim.Get() : WalkAnim.Get(), true, bRun ? 1.2f : 1.f);
		}
		else
		{
			PlayAnim(IdleAnim, true);
		}
		if (bTakeOff)
		{
			Mode = EDragonMode::TakingOff;
			ModeTime = 0.f;
			PlayAnim(TakeoffAnim, false);
		}
		break;
	}
	case EDragonMode::TakingOff:
	{
		const float Length = TakeoffAnim ? TakeoffAnim->GetPlayLength() : 1.f;
		const float T = FMath::Clamp(ModeTime / Length, 0.f, 1.f);
		BodyDrop = FullDrop * (1.f - T);
		Loc.Z += 500.f * T * Dt; // starts to climb as the wings take hold
		if (ModeTime >= Length)
		{
			Mode = EDragonMode::Flying;
			BodyDrop = 0.f;
			Speed = CruiseSpeed * 0.85f; // enough to keep climbing without stalling
			Pitch = 10.f;
			PlayAnim(FlyAnim, true);
		}
		break;
	}
	default:
		break;
	}

	SetActorLocationAndRotation(Loc, FRotator(Pitch, Yaw, Roll));
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
