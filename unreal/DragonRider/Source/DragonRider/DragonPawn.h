#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "DragonPawn.generated.h"

class USphereComponent;
class UPoseableMeshComponent;
class UStaticMeshComponent;
class USpringArmComponent;
class UCameraComponent;

/**
 * The dragon with its rider. Flies with a simple arcade model: it always moves forward,
 * diving gains speed, climbing loses it, and flapping adds thrust.
 * The wings, neck and tail are moved by code every frame, so no animation assets are needed.
 */
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
	bool IsTurningBack() const { return bTurningBack; }

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

private:
	struct FBoneRef
	{
		int32 Index = INDEX_NONE;
		FQuat ParentRefComp = FQuat::Identity;
		FQuat LocalRef = FQuat::Identity;
		float Side = 1.f;
	};

	void CacheBones();
	/** Turns a bone by a rotation given in the dragon's own space, on top of its rest pose. */
	void TurnBone(FName Bone, const FQuat& Delta);
	float SideOf(FName Bone) const;
	void AnimateBody(float DeltaSeconds, bool bFlapping);

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USphereComponent> Body;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UPoseableMeshComponent> Mesh;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UStaticMeshComponent> Placeholder;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<USpringArmComponent> Arm;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UCameraComponent> Camera;

	TMap<FName, FBoneRef> Bones;

	float Speed = 3200.f;
	float Pitch = 0.f;
	float Yaw = 0.f;
	float Roll = 0.f;
	float TurnRate = 0.f;
	float FlapPhase = 0.f;
	float FlapAmount = 0.3f;
	float Fold = 0.f;
	float Clock = 0.f;
	bool bTurningBack = false;
};
