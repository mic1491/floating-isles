#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonProps.generated.h"

class UAudioComponent;
class UHierarchicalInstancedStaticMeshComponent;
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

	/** The middle of each village, for whoever else wants to stand guard there. */
	const TArray<FVector2D>& GetVillages() const { return VillageCentres; }

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
		int8 Kind = -1;          // which real tree model, or -1 for a house or a plain cone tree
		float Scale = 1.f;
		bool bBare = false;      // its leaves have burnt away
	};

	void AddTree(const FVector& Ground, float Height, float Yaw, float Shade);
	void AddHouse(const FVector& Ground, float Yaw, float Shade);
	void Ignite(int32 Index);
	void ShowBurn(FProp& P, float Char, float Glow);
	void AddRealTree(int32 Kind, const FVector& Ground, float Scale, float Yaw);

	/**
	 * One of the tree models from the Open World Demo Collection (Content/KiteDemo, not kept in
	 * the repository). Living trees are drawn from Alive; when one's leaves have burnt off it is
	 * drawn from Burnt instead, which shows only the trunk and branches, charred and glowing.
	 * Without the collection the forest falls back to plain cones.
	 */
	struct FTreeKind
	{
		UHierarchicalInstancedStaticMeshComponent* Alive = nullptr;
		UInstancedStaticMeshComponent* Burnt = nullptr;
		float Height = 0.f;
	};
	TArray<FTreeKind> Kinds;

	/**
	 * Real houses, built from the pieces of the Faymere River Village pack (Content/FaymereVillage,
	 * not kept in the repository) as laid out in its houses.txt, which Tools/setup_assets.py writes.
	 * A burning house keeps its stone base; its timber is swapped for charred pieces, some of them
	 * fallen away, and its roof is gone. Without the pack the villages fall back to plain boxes.
	 */
	struct FHousePart
	{
		UHierarchicalInstancedStaticMeshComponent* Alive = nullptr;
		UInstancedStaticMeshComponent* Burnt = nullptr;
		bool bStone = false;
		bool bRoof = false;
	};
	struct FHousePiece
	{
		int32 Part = 0;
		FTransform Rel;
	};
	struct FHouseTimber
	{
		int32 Part = 0;
		int32 Instance = 0;
		FTransform World;
	};
	struct FHouseBuilt
	{
		TArray<FHouseTimber> Timber;          // the pieces that burn
		TArray<TPair<int32, int32>> Charred;  // part and instance of what is left standing afterwards
	};
	void LoadHouseKinds(UMaterialInterface* SootBase);
	void AddRealHouse(const FVector& Ground, float Yaw);
	TArray<FHousePart> HouseParts;
	TArray<TArray<FHousePiece>> HouseKinds;
	TArray<FHouseBuilt> Houses;
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

	/** The crackle of things burning, louder the more there is alight near the dragon. */
	UPROPERTY()
	TObjectPtr<UAudioComponent> BurnAudio;
	float IgniteWait = 0.f;

	TArray<FProp> Props;
	TArray<FVector2D> VillageCentres;
	TArray<int32> Burning;
	TMap<FIntPoint, TArray<int32>> Cells; // for finding neighbours to spread to
};
