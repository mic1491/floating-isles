#include "SICharacter.h"
#include "SIAnimInstance.h"
#include "SIEnemy.h"
#include "SIResources.h"
#include "SIStorm.h"
#include "SIUtil.h"
#include "SIWorld.h"
#include "Animation/AnimSequenceBase.h"
#include "Camera/CameraComponent.h"
#include "Camera/PlayerCameraManager.h"
#include "Components/CapsuleComponent.h"
#include "Components/SkeletalMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "EngineUtils.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"
#include "Kismet/KismetSystemLibrary.h"

namespace
{
	const float JogSpeed = 430.f;
	const float SprintSpeed = 680.f;
	const float HitReach = 170.f;

	UAnimSequenceBase* Anim(const TCHAR* Path)
	{
		return LoadObject<UAnimSequenceBase>(nullptr, *FString::Printf(TEXT("/Game/Characters/Mannequins/Anims/%s"), Path), nullptr, LOAD_NoWarn | LOAD_Quiet);
	}

	const FKey PieceKeys[NumPieces] = { EKeys::One, EKeys::Two, EKeys::Three, EKeys::Four, EKeys::Five };
}

ASICharacter::ASICharacter()
{
	PrimaryActorTick.bCanEverTick = true;
	GetCapsuleComponent()->InitCapsuleSize(38.f, 92.f);

	bUseControllerRotationYaw = false;
	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.f, 720.f, 0.f);
	Move->MaxWalkSpeed = JogSpeed;
	Move->JumpZVelocity = 520.f;
	Move->AirControl = 0.35f;
	Move->BrakingDecelerationWalking = 1800.f;
	Move->SetWalkableFloorAngle(50.f);
	Move->MaxStepHeight = 60.f;

	Arm = CreateDefaultSubobject<USpringArmComponent>(TEXT("Arm"));
	Arm->SetupAttachment(RootComponent);
	Arm->TargetArmLength = 420.f;
	Arm->SocketOffset = FVector(0.f, 55.f, 75.f);
	Arm->bUsePawnControlRotation = true;
	Arm->bEnableCameraLag = true;
	Arm->CameraLagSpeed = 14.f;
	Arm->ProbeSize = 14.f;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(Arm);
	Camera->SetFieldOfView(80.f);

	USkeletalMeshComponent* Body = GetMesh();
	Body->SetRelativeLocation(FVector(0.f, 0.f, -92.f));
	Body->SetRelativeRotation(FRotator(0.f, -90.f, 0.f));

	Handle = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Handle"));
	Handle->SetupAttachment(Body);
	Handle->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Head = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Head"));
	Head->SetupAttachment(Handle);
	Head->SetCollisionEnabled(ECollisionEnabled::NoCollision);
}

void ASICharacter::BeginPlay()
{
	Super::BeginPlay();
	SetActorLocation(ASIWorld::StartLocation() + FVector(0, 0, 40.f));
	SetActorRotation(FRotator(0.f, 90.f, 0.f));

	USkeletalMeshComponent* Body = GetMesh();
	if (USkeletalMesh* M = LoadObject<USkeletalMesh>(nullptr, TEXT("/Game/Characters/Mannequins/Meshes/SKM_Manny_Simple.SKM_Manny_Simple"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		Body->SetSkeletalMesh(M);
	}
	// The tool is attached again now the skeleton (and its hand bone) exists.
	Handle->AttachToComponent(Body, FAttachmentTransformRules::KeepRelativeTransform, TEXT("hand_r"));
	Body->SetAnimInstanceClass(USIAnimInstance::StaticClass());
	for (const TCHAR* S : { TEXT("Unarmed/Attack/MM_Attack_01.MM_Attack_01"), TEXT("Unarmed/Attack/MM_Attack_02.MM_Attack_02"), TEXT("Unarmed/Attack/MM_Attack_03.MM_Attack_03") })
	{
		if (UAnimSequenceBase* A = Anim(S))
		{
			Swings.Add(A);
		}
	}
	Death = Anim(TEXT("Death/MM_Death_Front_01.MM_Death_Front_01"));

	// The tool in the hand: a stick, and a stone head that changes with the tool.
	Handle->SetStaticMesh(Isle::Mesh(TEXT("Cylinder")));
	Handle->SetMaterial(0, Isle::Tinted(TEXT("M_Prop"), FLinearColor(0.16f, 0.09f, 0.04f), this));
	Handle->SetRelativeLocation(FVector(0.f, 0.f, 0.f));
	Handle->SetRelativeRotation(FRotator(0.f, 0.f, 0.f));
	Handle->SetRelativeScale3D(FVector(0.05f, 0.05f, 0.75f));
	Head->SetStaticMesh(Isle::Mesh(TEXT("Cube")));
	Head->SetMaterial(0, Isle::Tinted(TEXT("M_Prop"), FLinearColor(0.28f, 0.27f, 0.25f), this));
	RefreshTool();

	World = TActorIterator<ASIWorld>(GetWorld()) ? *TActorIterator<ASIWorld>(GetWorld()) : nullptr;
	Resources = TActorIterator<ASIResources>(GetWorld()) ? *TActorIterator<ASIResources>(GetWorld()) : nullptr;
	Building = TActorIterator<ASIBuilding>(GetWorld()) ? *TActorIterator<ASIBuilding>(GetWorld()) : nullptr;
	Storm = TActorIterator<ASIStorm>(GetWorld()) ? *TActorIterator<ASIStorm>(GetWorld()) : nullptr;

	if (APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		PC->SetInputMode(FInputModeGameOnly());
		PC->bShowMouseCursor = false;
		PC->SetControlRotation(FRotator(-12.f, 90.f, 0.f));
		if (PC->PlayerCameraManager)
		{
			PC->PlayerCameraManager->ViewPitchMin = -70.f;
			PC->PlayerCameraManager->ViewPitchMax = 45.f;
		}
	}
}

void ASICharacter::RefreshTool()
{
	// Show the best weapon carried: spear, else axe, else pick; nothing in bare hands.
	const bool bSpear = Owned[int32(ECraft::Spear)], bAxe = Owned[int32(ECraft::Axe)], bPick = Owned[int32(ECraft::Pick)];
	const bool bAny = bSpear || bAxe || bPick;
	Handle->SetVisibility(bAny, true);
	if (bSpear)
	{
		Handle->SetRelativeScale3D(FVector(0.045f, 0.045f, 1.6f));
		Head->SetStaticMesh(Isle::Mesh(TEXT("Cone")));
		Head->SetRelativeLocation(FVector(0.f, 0.f, 56.f));
		Head->SetRelativeScale3D(FVector(2.2f, 2.2f, 0.16f));
	}
	else if (bAny)
	{
		Handle->SetRelativeScale3D(FVector(0.05f, 0.05f, 0.75f));
		Head->SetStaticMesh(Isle::Mesh(TEXT("Cube")));
		Head->SetRelativeLocation(FVector(0.f, bAxe ? 2.5f : 0.f, 42.f));
		Head->SetRelativeScale3D(bAxe ? FVector(1.6f, 4.0f, 0.22f) : FVector(1.6f, 6.5f, 0.12f));
	}
}

bool ASICharacter::CanAfford(const FCost& Cost) const
{
	for (int32 i = 0; i < NumItems; ++i)
	{
		if (Items[i] < Cost.Amount[i])
		{
			return false;
		}
	}
	return true;
}

void ASICharacter::Spend(const FCost& Cost)
{
	for (int32 i = 0; i < NumItems; ++i)
	{
		Items[i] -= Cost.Amount[i];
	}
}

void ASICharacter::Gain(EItem Item, int32 Amount)
{
	if (Amount <= 0)
	{
		return;
	}
	Items[int32(Item)] += Amount;
	Gathered[int32(Item)] += Amount;
	const FLinearColor Colour = Item == EItem::Crystal ? FLinearColor(0.75f, 0.5f, 1.f) : FLinearColor(1.f, 0.92f, 0.7f);
	// Merge with a fresh line for the same thing, so chopping shows "+6 木材" rather than six lines.
	const FString Name = Isle::ItemName(Item);
	for (FFeedLine& L : Feed)
	{
		if (L.Age < 2.f && L.Text.EndsWith(Name))
		{
			const int32 Was = FCString::Atoi(*L.Text.Mid(1));
			L.Text = FString::Printf(TEXT("+%d %s"), Was + Amount, *Name);
			L.Age = 0.f;
			return;
		}
	}
	Feed.Insert({ FString::Printf(TEXT("+%d %s"), Amount, *Name), Colour, 0.f }, 0);
	if (Feed.Num() > 6)
	{
		Feed.SetNum(6);
	}
}

void ASICharacter::Say(const FString& Text, float Seconds)
{
	Notice = Text;
	NoticeTime = Seconds;
}

void ASICharacter::Hurt(float Amount, const FVector& From)
{
	if (IsDead())
	{
		return;
	}
	Health -= Amount;
	HurtFlash = FMath::Min(HurtFlash + Amount / 25.f, 1.f);
	Kick = 1.f;
	KickDir = (GetActorLocation() - From).GetSafeNormal2D();
	if (Health <= 0.f)
	{
		Health = 0.f;
		DeadTime = 0.f;
		bBuilding = bCrafting = false;
		if (Building) Building->ShowPreview(nullptr);
		if (USIAnimInstance* A = Cast<USIAnimInstance>(GetMesh()->GetAnimInstance()))
		{
			A->PlayAction(Death, 1.f, true);
		}
		GetCharacterMovement()->DisableMovement();
		// Half of what was carried is lost where the player fell; crystals and tools are kept.
		for (int32 i = 0; i < NumItems; ++i)
		{
			if (EItem(i) != EItem::Crystal)
			{
				Items[i] -= Items[i] / 2;
			}
		}
	}
}

void ASICharacter::Respawn()
{
	FVector P = ASIWorld::StartLocation() + FVector(0, 0, 40.f);
	if (Building)
	{
		Building->RespawnPoint(P);
	}
	SetActorLocation(P, false, nullptr, ETeleportType::TeleportPhysics);
	GetCharacterMovement()->SetMovementMode(MOVE_Walking);
	Health = 60.f;
	Hunger = FMath::Max(Hunger, 40.f);
	Warmth = FMath::Max(Warmth, 60.f);
	Stamina = 100.f;
	DeadTime = -1.f;
	if (USIAnimInstance* A = Cast<USIAnimInstance>(GetMesh()->GetAnimInstance()))
	{
		A->StopAction();
	}
	Say(TEXT("你醒了過來……身上的東西少了一半"), 4.f);
}

FVector ASICharacter::AimPoint() const
{
	const APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC)
	{
		return GetActorLocation() + GetActorForwardVector() * 300.f;
	}
	FVector CamLoc;
	FRotator CamRot;
	PC->GetPlayerViewPoint(CamLoc, CamRot);
	const FVector Dir = CamRot.Vector();
	FHitResult Hit;
	FCollisionQueryParams Q(TEXT("Aim"), false, this);
	const FVector Start = CamLoc + Dir * (Arm->TargetArmLength * 0.9f);
	if (GetWorld()->LineTraceSingleByChannel(Hit, Start, Start + Dir * 1400.f, ECC_Visibility, Q))
	{
		return Hit.ImpactPoint;
	}
	const FVector Far = Start + Dir * 600.f;
	return FVector(Far.X, Far.Y, ASIWorld::HeightAt(Far.X, Far.Y));
}

void ASICharacter::Craft(ECraft What)
{
	const int32 I = int32(What);
	if (What != ECraft::Bandage && Owned[I])
	{
		Say(FString::Printf(TEXT("已經有%s了"), Isle::CraftName(What)), 2.f);
		return;
	}
	if (!CanAfford(Isle::CraftCost(What)))
	{
		Say(FString::Printf(TEXT("材料不足：需要 %s"), *Isle::CostText(Isle::CraftCost(What))), 2.5f);
		return;
	}
	Spend(Isle::CraftCost(What));
	if (What == ECraft::Bandage)
	{
		++Bandages;
	}
	else
	{
		Owned[I] = true;
		RefreshTool();
	}
	Say(FString::Printf(TEXT("做好了：%s　（%s）"), Isle::CraftName(What), Isle::CraftNote(What)), 3.f);
}

void ASICharacter::Swing()
{
	USIAnimInstance* A = Cast<USIAnimInstance>(GetMesh()->GetAnimInstance());
	if (Swings.IsEmpty() || !A)
	{
		SwingTimer = 0.25f;
		SwingCooldown = 0.6f;
		return;
	}
	if (Stamina < 4.f)
	{
		return;
	}
	Stamina -= 4.f;
	SwingIndex = (SwingIndex + 1) % Swings.Num();
	const float Len = A->PlayAction(Swings[SwingIndex], 1.35f);
	SwingTimer = FMath::Min(Len * 0.4f, 0.35f);
	SwingCooldown = FMath::Min(Len * 0.75f, 0.7f);
	// Face where the camera looks before striking.
	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		SetActorRotation(FRotator(0.f, PC->GetControlRotation().Yaw, 0.f));
	}
}

void ASICharacter::Land()
{
	const FVector Here = GetActorLocation();
	const FVector Facing = GetActorForwardVector();

	// Creatures first: a blow at a wraith in reach always goes to it.
	float Damage = 12.f;
	if (Owned[int32(ECraft::Spear)]) Damage = 34.f;
	else if (Owned[int32(ECraft::Axe)]) Damage = 20.f;
	else if (Owned[int32(ECraft::Pick)]) Damage = 16.f;
	bool bHitCreature = false;
	for (TActorIterator<ASIEnemy> It(GetWorld()); It; ++It)
	{
		ASIEnemy* E = *It;
		if (E->IsDead())
		{
			continue;
		}
		const FVector To = E->GetActorLocation() - Here;
		const float Reach = HitReach + 60.f + (Owned[int32(ECraft::Spear)] ? 70.f : 0.f);
		if (To.Size2D() < Reach && FMath::Abs(To.Z) < 200.f && (To.GetSafeNormal2D() | Facing) > 0.3f)
		{
			E->Hurt(Damage, Here);
			bHitCreature = true;
		}
	}
	if (bHitCreature)
	{
		return;
	}

	FHarvest H;
	if (Resources && Resources->Strike(Here - FVector(0, 0, 90.f), Facing, HitReach, Owned[int32(ECraft::Axe)], Owned[int32(ECraft::Pick)], H))
	{
		Gain(H.Item, H.Amount);
		Gain(H.Extra, H.ExtraAmount);
		if (H.bDepleted)
		{
			switch (H.Kind)
			{
			case ENodeKind::Tree:
			case ENodeKind::Pine: Gain(EItem::Wood, 2); break;
			case ENodeKind::Rock: Gain(EItem::Stone, 2); break;
			case ENodeKind::Bush: Gain(EItem::Fiber, 1); break;
			default: break;
			}
		}
	}
}

void ASICharacter::UpdateBuilding()
{
	bHavePreview = false;
	if (!Building)
	{
		return;
	}
	if (!bBuilding || IsDead())
	{
		Building->ShowPreview(nullptr);
		return;
	}
	Preview = Building->Plan(Selected, AimPoint(), GetActorLocation(), GetActorRotation().Yaw);
	if (Preview.bValid && !CanAfford(Isle::PieceCost(Selected)))
	{
		Preview.bValid = false;
		Preview.Why = FString::Printf(TEXT("材料不足：需要 %s"), *Isle::CostText(Isle::PieceCost(Selected)));
	}
	bHavePreview = true;
	Building->ShowPreview(&Preview);
}

void ASICharacter::ReadInput(float Dt)
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC)
	{
		return;
	}
	if (PC->WasInputKeyJustPressed(EKeys::Escape) || PC->WasInputKeyJustPressed(EKeys::Gamepad_Special_Right))
	{
		if (bCrafting || bBuilding)
		{
			bCrafting = bBuilding = false;
		}
		else
		{
			UKismetSystemLibrary::QuitGame(this, PC, EQuitPreference::Quit, false);
		}
	}

	// Looking about, with the mouse or the right stick.
	float Mx = 0.f, My = 0.f;
	PC->GetInputMouseDelta(Mx, My);
	// The first frames after the window opens can report a huge jump; ignore those.
	if (Age < 0.5f || FMath::Abs(Mx) > 300.f || FMath::Abs(My) > 300.f)
	{
		Mx = My = 0.f;
	}
	Mx += PC->GetInputAnalogKeyState(EKeys::Gamepad_RightX) * 160.f * Dt;
	My += PC->GetInputAnalogKeyState(EKeys::Gamepad_RightY) * 110.f * Dt;
	AddControllerYawInput(Mx * 0.6f);
	AddControllerPitchInput(-My * 0.6f);

	if (IsDead())
	{
		return;
	}

	// Moving, relative to where the camera faces.
	const FRotator Yaw(0.f, PC->GetControlRotation().Yaw, 0.f);
	const float Fwd = (PC->IsInputKeyDown(EKeys::W) ? 1.f : 0.f) - (PC->IsInputKeyDown(EKeys::S) ? 1.f : 0.f) + PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftY);
	const float Side = (PC->IsInputKeyDown(EKeys::D) ? 1.f : 0.f) - (PC->IsInputKeyDown(EKeys::A) ? 1.f : 0.f) + PC->GetInputAnalogKeyState(EKeys::Gamepad_LeftX);
	const FVector Wish = Yaw.RotateVector(FVector(Fwd, Side, 0.f)).GetClampedToMaxSize(1.f);
	AddMovementInput(Wish, 1.f);

	const bool bWantSprint = PC->IsInputKeyDown(EKeys::LeftShift) || PC->IsInputKeyDown(EKeys::Gamepad_LeftThumbstick);
	bSprinting = bWantSprint && Wish.SizeSquared() > 0.1f && Stamina > 1.f && !GetCharacterMovement()->IsFalling();
	GetCharacterMovement()->MaxWalkSpeed = bSprinting ? SprintSpeed : JogSpeed;
	// Swinging slows the feet so blows land where they are aimed.
	if (SwingCooldown > 0.f)
	{
		GetCharacterMovement()->MaxWalkSpeed *= 0.45f;
	}

	if ((PC->WasInputKeyJustPressed(EKeys::SpaceBar) || PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Bottom)) && Stamina > 8.f && !GetCharacterMovement()->IsFalling())
	{
		Jump();
		Stamina -= 8.f;
	}

	// Menus: Tab for crafting, B for building.
	if (PC->WasInputKeyJustPressed(EKeys::Tab) || PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Top))
	{
		bCrafting = !bCrafting;
		bBuilding = false;
	}
	if (PC->WasInputKeyJustPressed(EKeys::B) || PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Left))
	{
		bBuilding = !bBuilding;
		bCrafting = false;
	}

	if (bCrafting)
	{
		const FKey Keys[NumCrafts] = { EKeys::One, EKeys::Two, EKeys::Three, EKeys::Four };
		for (int32 i = 0; i < NumCrafts; ++i)
		{
			if (PC->WasInputKeyJustPressed(Keys[i]))
			{
				Craft(ECraft(i));
			}
		}
	}
	else if (bBuilding)
	{
		for (int32 i = 0; i < NumPieces; ++i)
		{
			if (PC->WasInputKeyJustPressed(PieceKeys[i]))
			{
				Selected = EPiece(i);
			}
		}
		if (PC->WasInputKeyJustPressed(EKeys::MouseScrollDown) || PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Right))
		{
			Selected = EPiece((int32(Selected) + 1) % NumPieces);
		}
		if (PC->WasInputKeyJustPressed(EKeys::MouseScrollUp) || PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Left))
		{
			Selected = EPiece((int32(Selected) + NumPieces - 1) % NumPieces);
		}
		if (PC->WasInputKeyJustPressed(EKeys::LeftMouseButton) || PC->WasInputKeyJustPressed(EKeys::Gamepad_RightTrigger))
		{
			if (bHavePreview && Preview.bValid)
			{
				Spend(Isle::PieceCost(Selected));
				Building->Place(Preview);
				Say(FString::Printf(TEXT("蓋好了：%s"), Isle::PieceName(Selected)), 1.5f);
			}
			else if (bHavePreview)
			{
				Say(Preview.Why, 2.f);
			}
		}
	}
	else if ((PC->IsInputKeyDown(EKeys::LeftMouseButton) || PC->IsInputKeyDown(EKeys::Gamepad_RightTrigger)) && SwingCooldown <= 0.f)
	{
		Swing();
	}

	// Eating and bandaging.
	if (PC->WasInputKeyJustPressed(EKeys::E) || PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Up))
	{
		if (Items[int32(EItem::Berry)] > 0)
		{
			--Items[int32(EItem::Berry)];
			Hunger = FMath::Min(Hunger + 12.f, 100.f);
			Health = FMath::Min(Health + 2.f, 100.f);
			Say(TEXT("吃了一把莓果"), 1.2f);
		}
		else
		{
			Say(TEXT("沒有莓果了——去灌木叢採一些"), 2.f);
		}
	}
	if (PC->WasInputKeyJustPressed(EKeys::H) || PC->WasInputKeyJustPressed(EKeys::Gamepad_DPad_Down))
	{
		if (Bandages > 0 && Health < 100.f)
		{
			--Bandages;
			Health = FMath::Min(Health + 40.f, 100.f);
			Say(TEXT("用了草藥繃帶"), 1.5f);
		}
		else if (Bandages <= 0)
		{
			Say(TEXT("沒有繃帶——用纖維和莓果製作（Tab）"), 2.f);
		}
	}
}

void ASICharacter::UpdateStats(float Dt)
{
	const FVector P = GetActorLocation();
	const FVector Feet = P - FVector(0, 0, 92.f);
	bSheltered = Building && Building->IsSheltered(Feet);
	bNearFire = Building && Building->CampfireDistance(Feet) < 600.f;
	bInStorm = Storm && Storm->IsInside(P);
	const bool bNight = World && World->IsNight();

	if (bInStorm && !bWasInStorm)
	{
		Say(bSheltered ? TEXT("風暴來了——待在屋頂下！") : TEXT("你在風暴裡！快找有屋頂的地方躲！"), 3.f);
	}
	bWasInStorm = bInStorm;

	// Hunger wears down slowly; running and swinging make it faster.
	Hunger = FMath::Max(Hunger - Dt * (bSprinting ? 0.3f : 0.15f), 0.f);

	// Warmth: night and storm chill; a fire or sunshine warms.
	float Chill = 0.f;
	if (bNight) Chill += 0.5f;
	if (bInStorm && !bSheltered) Chill += 2.5f;
	if (GetActorLocation().Z < 30.f) Chill += 1.5f;    // wading in the sea
	if (bNearFire) Chill -= 8.f;
	else if (bSheltered) Chill -= 0.6f;
	else if (!bNight && !bInStorm) Chill -= 0.8f;
	Warmth = FMath::Clamp(Warmth - Chill * Dt, 0.f, 100.f);

	// Stamina comes back when not running.
	if (bSprinting)
	{
		Stamina = FMath::Max(Stamina - Dt * 14.f, 0.f);
	}
	else if (SwingCooldown <= 0.f)
	{
		Stamina = FMath::Min(Stamina + Dt * (Hunger > 20.f ? 18.f : 8.f), 100.f);
	}

	// Health: starving or freezing hurts; the storm hurts; well fed and warm heals.
	float Hp = 0.f;
	if (Hunger <= 0.f) Hp -= 1.2f;
	if (Warmth <= 0.f) Hp -= 1.5f;
	if (bInStorm && !bSheltered) Hp -= 1.f;
	if (Hunger > 50.f && Warmth > 40.f) Hp += bNearFire ? 2.5f : 0.6f;
	if (Hp < 0.f)
	{
		ColdTimer += Dt;
		if (ColdTimer > 1.f)
		{
			ColdTimer = 0.f;
			Hurt(-Hp, P - GetActorForwardVector());
		}
	}
	else
	{
		Health = FMath::Min(Health + Hp * Dt, 100.f);
	}
}

void ASICharacter::Tick(float Dt)
{
	Super::Tick(Dt);
	Age += Dt;
	ReadInput(Dt);

	if (IsDead())
	{
		DeadTime += Dt;
		if (DeadTime > 4.f)
		{
			Respawn();
		}
	}
	else
	{
		UpdateStats(Dt);
	}

	// The blow lands partway through the swing.
	SwingCooldown -= Dt;
	if (SwingTimer >= 0.f)
	{
		SwingTimer -= Dt;
		if (SwingTimer < 0.f && !IsDead())
		{
			Land();
		}
	}
	UpdateBuilding();

	// Keep to the island: deep water pushes the player back toward the shore.
	const FVector P = GetActorLocation();
	if (ASIWorld::HeightAt(P.X, P.Y) < -150.f || FVector2D(P).Size() > ASIWorld::IslandRadius * 1.25f)
	{
		const FVector Home = (-FVector(P.X, P.Y, 0.f)).GetSafeNormal();
		LaunchCharacter(Home * 500.f, true, false);
		if (NoticeTime <= 0.f)
		{
			Say(TEXT("海水太深，游不過去"), 2.f);
		}
	}
	if (P.Z < -3000.f)
	{
		SetActorLocation(ASIWorld::StartLocation() + FVector(0, 0, 40.f));
	}

	// Animation inputs.
	if (USIAnimInstance* A = Cast<USIAnimInstance>(GetMesh()->GetAnimInstance()))
	{
		A->Speed = GetVelocity().Size2D();
		A->bInAir = GetCharacterMovement()->IsFalling() && GetVelocity().Z < -150.f;
	}

	// A small kick of the camera when hurt.
	Kick = FMath::Max(Kick - Dt * 5.f, 0.f);
	Arm->SocketOffset = FVector(0.f, 55.f, 75.f) + FVector(0.f, 0.f, -12.f) * Kick;
	HurtFlash = FMath::Max(HurtFlash - Dt * 1.2f, 0.f);
	NoticeTime -= Dt;
	for (int32 i = Feed.Num() - 1; i >= 0; --i)
	{
		Feed[i].Age += Dt;
		if (Feed[i].Age > 4.f)
		{
			Feed.RemoveAt(i);
		}
	}
}

void ASICharacter::DebugGive()
{
	for (int32 i = 0; i < NumItems; ++i)
	{
		Items[i] += 60;
	}
	for (int32 i = 0; i < NumCrafts - 1; ++i)
	{
		Owned[i] = true;
	}
	Bandages = 3;
	RefreshTool();
}
