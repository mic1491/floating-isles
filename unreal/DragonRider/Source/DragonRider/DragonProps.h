#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonProps.generated.h"

class UInstancedStaticMeshComponent;

/**
 * The forests and villages on the islands, and how they burn.
 *
 * Trees and houses are simple shapes drawn in batches. The dragon's breath sets alight whatever
 * it sweeps over; a burning thing glows, throws flames, chars to black and can set fire to its
 * neighbours, so one pass over a forest edge can take the whole wood.
 */
UCLASS()
class ADragonProps : public AActor
{
	GENERATED_BODY()

public:
	ADragonProps();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	int32 NumTrees = 0;
	int32 NumHouses = 0;
	int32 TreesBurned = 0;
	int32 HousesBurned = 0;

private:
	struct FProp
	{
		FVector Pos = FVector::ZeroVector; // on the ground
		float Height = 0.f;
		float Yaw = 0.f;
		bool bHouse = false;
		int32 Low = INDEX_NONE;  // instance of the trunk or the walls
		int32 High = INDEX_NONE; // instance of the leaves or the roof
		float Burn = 0.f;        // seconds on fire; 0 means untouched
		bool bSpread = false;
		bool bDone = false;
	};

	void AddTree(const FVector& Ground, float Height, float Yaw, float Shade);
	void AddHouse(const FVector& Ground, float Yaw, float Shade);
	void Ignite(int32 Index);
	void ShowBurn(const FProp& P, float Char, float Glow);
	FTransform HighTransform(const FProp& P, float Shrink) const;
	static FIntPoint CellOf(const FVector& P);

	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Trunks;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Leaves;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Walls;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Roofs;

	TArray<FProp> Props;
	TArray<int32> Burning;
	TMap<FIntPoint, TArray<int32>> Cells; // for finding neighbours to spread to
};
