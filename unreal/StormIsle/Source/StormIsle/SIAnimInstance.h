#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "SIAnimInstance.generated.h"

class UAnimSequenceBase;

/**
 * Animates a mannequin without an animation blueprint: idle, walk and jog are blended by speed,
 * a falling loop takes over in the air, and one-off actions (a swing, a flinch, dying) are faded in
 * on top and back out. The owner sets the values below every frame.
 */
UCLASS()
class USIAnimInstance : public UAnimInstance
{
	GENERATED_BODY()

public:
	/** Ground speed in cm/s and whether the feet are off the ground. */
	float Speed = 0.f;
	bool bInAir = false;

	/** Starts a one-off animation over the movement; returns its length in seconds. */
	float PlayAction(UAnimSequenceBase* Anim, float Rate = 1.f, bool bHoldLastFrame = false);
	void StopAction();
	bool IsActing() const { return Action != nullptr; }

	virtual void NativeInitializeAnimation() override;
	virtual void NativeUpdateAnimation(float DeltaSeconds) override;

	UPROPERTY()
	TObjectPtr<UAnimSequenceBase> Idle;
	UPROPERTY()
	TObjectPtr<UAnimSequenceBase> Walk;
	UPROPERTY()
	TObjectPtr<UAnimSequenceBase> Jog;
	UPROPERTY()
	TObjectPtr<UAnimSequenceBase> Fall;
	UPROPERTY()
	TObjectPtr<UAnimSequenceBase> Action;

	/** Speeds at which the walk and jog clips look right, in cm/s. */
	float WalkSpeed = 170.f;
	float JogSpeed = 420.f;

	// Read by the worker-thread proxy.
	float IdleTime = 0.f, MoveTime = 0.f, FallTime = 0.f, ActionTime = 0.f;
	float WalkWeight = 0.f, JogWeight = 0.f, FallWeight = 0.f, ActionWeight = 0.f;

private:
	float ActionRate = 1.f;
	bool bHold = false;

protected:
	virtual FAnimInstanceProxy* CreateAnimInstanceProxy() override;
};
