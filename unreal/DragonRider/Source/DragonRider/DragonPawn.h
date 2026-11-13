#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "DragonPawn.generated.h"

class UAnimSequence;
class UCameraComponent;
class UInstancedStaticMeshComponent;
class UPointLightComponent;
class USkeletalMesh;
class USkeletalMeshComponent;
class USphereComponent;
class USpringArmComponent;
class UStaticMeshComponent;

/**
 * The dragon with its rider. Flies with a simple arcade model: it always moves forward,
 * diving gains speed, climbing loses it, and flapping adds thrust.
 *
 * The dragon itself is the "Sakura Dragon" asset from Fab (Content/SakuraDragon, not kept in
 * the repository). Without it a plain cone stands in, and everything else still works.
 */
/** What the dragon is doing. Flight is the normal state; the rest handle being on the ground. */
enum class EDragonMode : uint8
{
	Flying,
	Descending, // gliding down to the chosen landing spot
	Landing,    // touching down
	Grounded,
	TakingOff,
};

UCLASS()
class ADragonPawn : public APawn
{
	GENERATED_BODY()

public:
	ADragonPawn();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Burst of speed, given when a ring is passed. */
	void Boost();

	float GetSpeed() const { return Speed; }

	/** Fire breath. Hold F, the right mouse button or the right trigger; it drains Fuel. */
	bool IsBreathingFire() const { return bBreathing; }
	float GetFuel() const { return Fuel; }
	FVector GetMouthLocation() const;
	FVector GetFireDirection() const;
	/** A puff of flame at a point in the world, used when something burns up. */
	void FireBurst(const FVector& Location);
	/** One puff of flame anywhere in the world, for things that are on fire. */
	void FlamePuff(const FVector& Location, const FVector& Velocity, float Life);

	/** Camera views, cycled with C or the gamepad's top face button. */
	void SetView(int32 NewView);
	const TCHAR* GetViewName() const { return ViewName; }
	bool IsTurningBack() const { return bTurningBack; }

	/** Landing: G (gamepad X) over an island sets the dragon down; on the ground it walks, runs and breathes fire, and Space takes off again. */
	bool IsGrounded() const { return Mode == EDragonMode::Grounded; }
	bool IsFlying() const { return Mode == EDragonMode::Flying; }
	/** A short message for the player, such as why a landing was refused; empty when there is none. */
	const FString& GetNotice() const { return Notice; }

	/** The opening scene: the dragon on a mountain shoulder roars, breathes fire and takes off. Space skips it. */
	/**
	 * Story scenes: while a shot is set (0 face, 1 side, 2 low from behind, 3 high and wide,
	 * 4 over the rider's shoulder) the camera holds it and the player's controls are paused;
	 * -1 gives both back. On the ground, shot 0 also makes the dragon roar.
	 */
	void SetCutsceneShot(int32 Shot);
	bool InCutscene() const { return CutShot >= 0; }
	bool IsIntro() const { return bIntro; }
	float GetIntroTime() const { return IntroTime; }

	UPROPERTY(EditAnywhere, Category = "Flight")
	float CruiseSpeed = 3200.f;
	UPROPERTY(EditAnywhere, Category = "Flight")
	float MinSpeed = 900.f;
	UPROPERTY(EditAnywhere, Category = "Flight")
	float MaxSpeed = 9000.f;
	UPROPERTY(EditAnywhere, Category = "Flight")
	float FlapThrust = 2600.f;
	UPROPERTY(EditAnywhere, Category = "Flight")
	float TurnSpeed = 60.f;
	UPROPERTY(EditAnywhere, Category = "Flight")
	float PitchSpeed = 55.f;
	UPROPERTY(EditAnywhere, Category = "Flight")
	float MouseSensitivity = 0.12f;

	/** Used for the flame's start only when the model has no MouthBone. */
	UPROPERTY(EditAnywhere, Category = "Fire")
	FVector MouthOffset = FVector(560.f, 0.f, 140.f);
	/** Bone at the front of the mouth; the flame leaves from here and follows the animation. */
	UPROPERTY(EditAnywhere, Category = "Fire")
	FName MouthBone = TEXT("tongue_03");
	UPROPERTY(EditAnywhere, Category = "Fire")
	float FuelSeconds = 4.f;
	UPROPERTY(EditAnywhere, Category = "Fire")
	float RefuelSeconds = 6.f;

	/** How much bigger than the asset the dragon is drawn. */
	UPROPERTY(EditAnywhere, Category = "Look")
	float DragonScale = 1.5f;
	/** Multiplied into the dragon's colours; white leaves the asset's own pearl-and-pink look. */
	UPROPERTY(EditAnywhere, Category = "Look")
	FLinearColor BodyTint = FLinearColor(0.34f, 0.19f, 0.10f);
	UPROPERTY(EditAnywhere, Category = "Look")
	FLinearColor WingTint = FLinearColor(0.42f, 0.13f, 0.08f);
	UPROPERTY(EditAnywhere, Category = "Look")
	FLinearColor GlowTint = FLinearColor(1.0f, 0.35f, 0.05f);

private:
	struct FFlame
	{
		FVector Pos = FVector::ZeroVector;
		FVector Vel = FVector::ZeroVector;
		float Age = 0.f;
		float Life = 0.f; // zero means the slot is free
	};
	void EmitFlame(const FVector& Pos, const FVector& Vel, float Life);
	void UpdateFire(float DeltaSeconds, bool bWantsFire);
	void SeatRider();
	void StartIntro();
	void TickCutCamera();
	void TickIntro(float Dt, bool bSkip);
	void AimCamera(const FVector& Pivot, float ArmYaw, float Length, float Lift, float Tilt);
	void TryLand();
	void PutOnGround(const FVector2D& Where);
	void TickGround(float Dt, float TurnIn, float Forward, float MouseX, bool bRun, bool bTakeOff);
	void PlayAnim(UAnimSequence* Anim, bool bLoop, float Rate = 1.f);
	float StandHeight() const;

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USphereComponent> Body;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USkeletalMeshComponent> Mesh;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Rider;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Placeholder;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USpringArmComponent> Arm;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCameraComponent> Camera;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UInstancedStaticMeshComponent> Flames;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UPointLightComponent> FireLight;

	UPROPERTY()
	TObjectPtr<UAnimSequence> FlyAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> HoverAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> LandAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> TakeoffAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> IdleAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> WalkAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> RunAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> BreathAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> RoarAnim;
	UPROPERTY()
	TObjectPtr<UAnimSequence> CurrentAnim;

	bool bIntro = false;
	int32 CutShot = -1;
	float CutTime = 0.f;
	bool bIntroFire = false;
	float IntroTime = 0.f;

	EDragonMode Mode = EDragonMode::Flying;
	float ModeTime = 0.f;
	FVector LandFrom = FVector::ZeroVector;
	FVector LandTo = FVector::ZeroVector;
	float LandDuration = 1.f;
	/** How far the body sits below its flying height: the ground animations stand ~3 m lower than the flight ones. */
	float BodyDrop = 0.f;
	FVector ViewPivot = FVector::ZeroVector;
	FString Notice;
	float NoticeTime = 0.f;

	TArray<FFlame> FlamePool;
	int32 NextFlame = 0;
	float EmitDebt = 0.f;
	float Fuel = 1.f;
	bool bBreathing = false;
	bool bFuelSpent = false;

	FVector MeshRestLocation = FVector::ZeroVector;
	float Speed = 3200.f;
	float Pitch = 0.f;
	float Yaw = 0.f;
	float Roll = 0.f;
	float TurnRate = 0.f;
	float FlapAmount = 0.3f;
	bool bTurningBack = false;
	int32 View = 0;
	const TCHAR* ViewName = TEXT("");
};
