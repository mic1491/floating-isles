#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonGround.generated.h"

class ADragonProps;
class UHierarchicalInstancedStaticMeshComponent;

/**
 * Rocks and grass on the islands, from the Open World Demo Collection (Content/KiteDemo, not kept
 * in the repository; without it there are none).
 *
 * Rocks are laid out once over the whole map: big boulders on the slopes and high ground, scree on
 * the steepest faces and stones along the shore. Grass, heather, ferns, flowers and bushes are far
 * too many for the whole map, so they grow only in a ring round the dragon and are laid out afresh
 * as it moves, always the same at the same spot. Nothing grows on burnt ground, nor where the dragon
 * has walked: it treads the plants down as it goes.
 */
UCLASS()
class ADragonGround : public AActor
{
	GENERATED_BODY()

public:
	ADragonGround();
	virtual void Tick(float DeltaSeconds) override;

private:
	struct FKind
	{
		UHierarchicalInstancedStaticMeshComponent* Mesh = nullptr;
		float MinScale = 1.f;
		float MaxScale = 1.f;
		float Sink = 0.f; // how far into the ground, as a share of its height
		float Height = 0.f;
	};

	bool AddKind(TArray<FKind>& Into, const TCHAR* Path, float MinScale, float MaxScale, float Sink, bool bShadow, int32 CullFrom, int32 CullTo);
	void PlaceRocks();
	void PlaceGrass(const FIntPoint& Centre, bool bThick);
	bool NearVillage(const FVector2D& P, float Radius) const;
	/** Treads down the plants round a point, and keeps them from growing there again. */
	void Trample(const FVector& Where);
	static bool Trodden(const FVector2D& P, const TArray<FVector2D>& Spots);

	UPROPERTY()
	TObjectPtr<ADragonProps> Props;

	TArray<FKind> Boulders, Scree, Shore, Grass;
	bool bStarted = false;
	bool bHasGrass = false;
	bool bGrassThick = false;
	// Which of Grass is which plant; INDEX_NONE when it is missing from the pack.
	int32 GrassKind = INDEX_NONE;
	int32 HeatherKind = INDEX_NONE;
	TArray<int32> FernKinds, FlowerKinds, BushKinds;
	// Spots the dragon has walked over, oldest first.
	TArray<FVector2D> Trampled;
	FVector2D LastTrodden = FVector2D(1e12, 1e12);
	FIntPoint GrassCentre = FIntPoint(INT32_MAX, INT32_MAX);
	int32 GrassScorchCount = -1;
};
