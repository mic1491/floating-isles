#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SITypes.h"
#include "SIResources.generated.h"

class UInstancedStaticMeshComponent;

enum class ENodeKind : uint8 { Tree, Pine, Rock, Bush, Crystal };

/** What one blow on a resource gave. */
struct FHarvest
{
	ENodeKind Kind = ENodeKind::Tree;
	EItem Item = EItem::Wood;
	int32 Amount = 0;
	EItem Extra = EItem::Berry;
	int32 ExtraAmount = 0;
	bool bDepleted = false;
	FVector Where = FVector::ZeroVector;
};

/**
 * Everything on the island that can be gathered: broadleaf trees and pines for wood, rocks for
 * stone, bushes for fibre and berries, and the crystals storms leave behind. Each is drawn with
 * instanced meshes; struck enough times it falls, and grows back later (crystals do not).
 */
UCLASS()
class ASIResources : public AActor
{
	GENERATED_BODY()

public:
	ASIResources();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Strikes the nearest resource in front of the player within Reach. False if nothing is there. */
	bool Strike(const FVector& From, const FVector& Facing, float Reach, bool bAxe, bool bPick, FHarvest& Out);
	/** True if something solid stands within Radius of P (so a building cannot go there). */
	bool IsCrowded(const FVector& P, float Radius) const;
	/** Leaves a storm crystal on the ground. */
	void SpawnCrystal(const FVector& Near);
	int32 CrystalsLeft() const;
	/** The nearest standing crystal to P, if any. */
	bool NearestCrystal(const FVector& P, FVector& Out) const;

private:
	struct FPart
	{
		int32 Comp;
		int32 Instance;
		FTransform Transform;
	};
	struct FNode
	{
		ENodeKind Kind;
		FVector Pos;
		float Radius;
		int32 Hits;
		int32 MaxHits;
		float RespawnAt = -1.f;
		float Flash = 0.f;
		float Shake = 0.f;
		bool bGone = false;
		TArray<FPart> Parts;
	};

	int32 AddPart(FNode& N, int32 Comp, const FTransform& T);
	void SetVisible(FNode& N, bool bVisible);
	void Populate();

	UPROPERTY()
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Comps;
	TArray<FNode> Nodes;
	TArray<int32> Flashing;
	float Clock = 0.f;
};
