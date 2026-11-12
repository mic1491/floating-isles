#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonWorld.generated.h"

class UProceduralMeshComponent;
class UMaterialInterface;
class UMaterialInstanceDynamic;
class UStaticMeshComponent;

/**
 * Builds the whole playable world in code when the game starts: sky, sun, fog, clouds,
 * an ocean, a generated island terrain and a course of rings to fly through.
 * Nothing here needs a level made in the editor.
 */
UCLASS()
class ADragonWorld : public AActor
{
	GENERATED_BODY()

public:
	ADragonWorld();

	/** Terrain height in cm at a world position. Below zero is under the sea. */
	static float HeightAt(float X, float Y);
	/** Where the dragon starts, in the air above the middle of the map. */
	static FVector StartLocation();
	/** Beyond this distance from the centre the dragon is turned back. */
	static constexpr float PlayRadius = 1000000.f;

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	int32 NextRing = 0;
	int32 NumRings() const { return Rings.Num(); }
	float CourseTime = 0.f;
	bool bStarted = false;
	bool bFinished = false;
	/** Centre of the next ring, or false when the course is finished. */
	bool GetNextRingLocation(FVector& Out) const;

	/** Floating fire-lanterns beside the course that the dragon's breath burns up. */
	int32 Burned = 0;
	int32 NumTargets() const { return Targets.Num(); }

private:
	void BuildSky();
	void BuildOcean();
	void BuildTerrain();
	void BuildRings();
	void BuildTargets();
	void RefreshRingColours();

	UPROPERTY()
	TObjectPtr<UProceduralMeshComponent> Terrain;
	UPROPERTY()
	TArray<TObjectPtr<UProceduralMeshComponent>> RingMeshes;
	UPROPERTY()
	TArray<TObjectPtr<UMaterialInstanceDynamic>> RingMats;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> TerrainMat;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> GlowMat;
	UPROPERTY()
	TObjectPtr<UMaterialInterface> WaterMat;

	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> Targets;
	float Clock = 0.f;

	TArray<FTransform> Rings;
	FVector PrevPawnPos = FVector::ZeroVector;
	bool bHavePrev = false;
};
