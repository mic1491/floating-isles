#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimSingleNodeInstance.h"
#include "DragonAnimInstance.generated.h"

/**
 * Plays one animation, like the engine's single-animation player, and on top of it swings the
 * jaw open by JawOpen (0 closed, 1 wide). This lets the dragon open its mouth to breathe fire
 * while the flight animation keeps playing, without an animation blueprint.
 */
UCLASS()
class UDragonAnimInstance : public UAnimSingleNodeInstance
{
	GENERATED_BODY()

public:
	/** Set every frame by the pawn. */
	float JawOpen = 0.f;
	float JawDegrees = 28.f;
	FName JawBone = TEXT("jaw");

	virtual void NativeInitializeAnimation() override;

	/** The jaw's parent's rotation in the mesh's rest pose, used to turn the jaw about the mesh's side-to-side axis. */
	FQuat JawParentRest = FQuat::Identity;

protected:
	virtual FAnimInstanceProxy* CreateAnimInstanceProxy() override;
};
