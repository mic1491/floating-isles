#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "SIEnemy.generated.h"

class UAnimSequenceBase;
class UPointLightComponent;

/**
 * A storm wraith: a dark figure with a glowing violet edge that comes with storms and at night.
 * It hunts the player, strikes in reach, and burns away in daylight outside the storm.
 * Sometimes leaves a storm crystal when beaten.
 */
UCLASS()
class ASIEnemy : public ACharacter
{
	GENERATED_BODY()

public:
	ASIEnemy();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	void Hurt(float Amount, const FVector& From);
	bool IsDead() const { return DeadTime >= 0.f; }
	float Health = 60.f;

private:
	UPROPERTY()
	TArray<TObjectPtr<UAnimSequenceBase>> Swings;
	UPROPERTY()
	TObjectPtr<UAnimSequenceBase> Death;
	UPROPERTY()
	TObjectPtr<UPointLightComponent> Glow;

	float AttackTimer = -1.f;
	float Cooldown = 0.f;
	float DeadTime = -1.f;
	float Stagger = 0.f;
	float Wander = 0.f;
	FVector WanderDir = FVector::ForwardVector;
	float Sun = 0.f;
};
