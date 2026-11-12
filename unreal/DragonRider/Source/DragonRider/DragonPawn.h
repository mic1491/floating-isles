#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "DragonPawn.generated.h"

class USkeletalMesh;
class USphereComponent;
class UPoseableMeshComponent;
class UStaticMeshComponent;
class USpringArmComponent;
class UCameraComponent;
class UInstancedStaticMeshComponent;
class UPointLightComponent;

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

	/** Fire breath. Hold F, the right mouse button or the right trigger; it drains Fuel. */
	bool IsBreathingFire() const { return bBreathing; }
	float GetFuel() const { return Fuel; }
	FVector GetMouthLocation() const;
	FVector GetFireDirection() const;
	/** A puff of flame at a point in the world, used when something burns up. */
	void FireBurst(const FVector& Location);
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

	/** Where the flame leaves the mouth, relative to the dragon. Depends on the model. */
	UPROPERTY(EditAnywhere, Category = "Fire")
	FVector MouthOffset = FVector(500.f, 0.f, 110.f);
	UPROPERTY(EditAnywhere, Category = "Fire")
	float FuelSeconds = 4.f;
	UPROPERTY(EditAnywhere, Category = "Fire")
	float RefuelSeconds = 6.f;

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

	struct FFlame
	{
		FVector Pos = FVector::ZeroVector;
		FVector Vel = FVector::ZeroVector;
		float Age = 0.f;
		float Life = 0.f; // zero means the slot is free
	};
	void EmitFlame(const FVector& Pos, const FVector& Vel, float Life);
	void UpdateFire(float DeltaSeconds, bool bWantsFire);

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

	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UInstancedStaticMeshComponent> Flames;
	UPROPERTY(VisibleAnywhere)
	TObjectPtr<UPointLightComponent> FireLight;

	UPROPERTY()
	TObjectPtr<USkeletalMesh> DragonAsset;

	TArray<FFlame> FlamePool;
	int32 NextFlame = 0;
	float EmitDebt = 0.f;
	float Fuel = 1.f;
	bool bBreathing = false;
	bool bFuelSpent = false;

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
