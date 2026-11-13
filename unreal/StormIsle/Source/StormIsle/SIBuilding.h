#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SITypes.h"
#include "SIBuilding.generated.h"

class UInstancedStaticMeshComponent;
class UStaticMeshComponent;
class UPointLightComponent;
class UMaterialInstanceDynamic;
class ASIResources;

/** Where a piece would go, and whether it can. */
struct FPlacement
{
	EPiece Piece = EPiece::Floor;
	FTransform Transform;
	bool bValid = false;
	FString Why;            // why it cannot go there
	FIntVector Key;         // the grid slot it fills
};

/**
 * Everything the player builds. Floors and roofs fill 4 m grid cells, walls stand on the cell edges,
 * and campfires and the beacon go anywhere on open ground. Shows a see-through preview of the piece
 * being placed: green where it fits, red where it does not.
 */
UCLASS()
class ASIBuilding : public AActor
{
	GENERATED_BODY()

public:
	ASIBuilding();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Works out where Piece would go for a player at PlayerPos aiming at Aim. */
	FPlacement Plan(EPiece Piece, const FVector& Aim, const FVector& PlayerPos, float PlayerYaw) const;
	void Place(const FPlacement& P);
	void ShowPreview(const FPlacement* P);

	/** A roof over this spot keeps the storm off. */
	bool IsSheltered(const FVector& Feet) const;
	/** Distance to the nearest burning campfire, or a large number. */
	float CampfireDistance(const FVector& P) const;
	bool HasBeacon() const { return bBeacon; }
	FVector BeaconLocation() const { return Beacon; }
	/** Where the player comes back after falling: the newest campfire, if any. */
	bool RespawnPoint(FVector& Out) const;

	int32 Count(EPiece P) const { return Counts[int32(P)]; }

private:
	float FloorTop(const FIntPoint& Cell) const;
	float GroundTop(const FVector2D& Centre, float Half) const;

	UPROPERTY()
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Parts;
	UPROPERTY()
	TObjectPtr<UStaticMeshComponent> Ghost;
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> GhostMat;
	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> Flames;
	UPROPERTY()
	TArray<TObjectPtr<UPointLightComponent>> Lights;
	UPROPERTY()
	TObjectPtr<ASIResources> Resources;

	TMap<FIntPoint, float> Floors;     // cell -> height of its top
	TMap<FIntPoint, float> Roofs;      // cell -> height of its underside
	TSet<FIntVector> Walls;            // (x, y, 0) runs along Y at x; (x, y, 1) runs along X at y
	TArray<FVector> Campfires;
	int32 Counts[NumPieces] = {};
	bool bBeacon = false;
	FVector Beacon = FVector::ZeroVector;
	float Clock = 0.f;
};
