#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonFoes.generated.h"

class ADragonPawn;
class ADragonProps;
class UHierarchicalInstancedStaticMeshComponent;
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
	bool BuildRealKinds(class UMaterialInterface* SootBase);
	void AddRealTower(int32 Index);
	void ShowRealTower(int32 Index);

	/**
	 * Real towers, from the Faymere River Village pack's pieces (Content/FaymereVillage, not kept in
	 * the repository): a six-sided tower of mossy stone, a timber platform and parapet, a ladder,
	 * and on top a ballista of wooden beams that turns to follow the dragon. Burnt out, the stone
	 * stands, the timber is charred and the ballista lies tipped over. Without the pack, plain shapes.
	 */
	struct FTowerMesh
	{
		UInstancedStaticMeshComponent* Alive = nullptr; // hierarchical for the fixed pieces, plain for the ballista's beams which turn every frame
		UInstancedStaticMeshComponent* Burnt = nullptr;
	};
	struct FTowerPiece
	{
		int32 Mesh = 0;
		FTransform Rel;
		bool bTurns = false;  // part of the ballista
		bool bTimber = false; // chars when the tower burns
	};
	TArray<FTowerMesh> TowerMeshes;
	TArray<FTowerPiece> TowerPieces;
	TArray<TArray<int32>> TowerInstances; // per tower, the instance of each piece
	bool bReal = false;
	float TopZ = 1650.f; // height above the ground where bolts leave the ballista
	float FlameWait = 0.f;
	void ShowTower(int32 Index);

	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Bases;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Tops;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Bows;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> BoltMeshes;

	UPROPERTY()
	TObjectPtr<ADragonProps> Props;
	TArray<FTower> Towers;
	TArray<FBolt> Bolts;
	FVector LastDragonPos = FVector::ZeroVector;
	bool bBuilt = false;
};
