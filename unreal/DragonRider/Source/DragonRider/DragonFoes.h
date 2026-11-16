#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonFoes.generated.h"

class ADragonPawn;
class UInstancedStaticMeshComponent;

/**
 * The raiders' ballista towers. Two stand guard at every village; when the dragon comes in
 * range they turn to follow it and shoot bolts ahead of its path, which can be dodged by
 * turning. The dragon's breath chars a tower until it burns out and falls silent.
 */
UCLASS()
class ADragonFoes : public AActor
{
	GENERATED_BODY()

public:
	ADragonFoes();
	virtual void Tick(float DeltaSeconds) override;

	int32 NumTowers() const { return Towers.Num(); }
	int32 TowersBurned = 0;

private:
	struct FTower
	{
		FVector Pos = FVector::ZeroVector; // on the ground
		float Health = 100.f;
		float Reload = 0.f;
		float Aim = 0.f;                    // yaw the bow points at
	};
	struct FBolt
	{
		FVector Pos = FVector::ZeroVector;
		FVector Vel = FVector::ZeroVector;
		float Life = 0.f;                   // zero means the slot is free
	};

	void Build();
	void ShowTower(int32 Index);

	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Bases;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Tops;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Bows;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> BoltMeshes;

	TArray<FTower> Towers;
	TArray<FBolt> Bolts;
	FVector LastDragonPos = FVector::ZeroVector;
	bool bBuilt = false;
};
