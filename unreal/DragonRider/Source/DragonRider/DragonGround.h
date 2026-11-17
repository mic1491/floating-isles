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
 * as it moves, always the same at the same spot. Nothing grows on burnt ground.
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
	void PlaceGrass(const FIntPoint& Centre);
	bool NearVillage(const FVector2D& P, float Radius) const;

	UPROPERTY()
	TObjectPtr<ADragonProps> Props;

	TArray<FKind> Boulders, Scree, Shore, Grass;
	bool bStarted = false;
	bool bHasGrass = false;
	FIntPoint GrassCentre = FIntPoint(INT32_MAX, INT32_MAX);
	int32 GrassScorchCount = -1;
};
