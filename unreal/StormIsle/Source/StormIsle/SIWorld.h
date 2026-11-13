#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SIWorld.generated.h"

class UProceduralMeshComponent;
class UMaterialInterface;
class UDirectionalLightComponent;
class USkyLightComponent;
class UExponentialHeightFogComponent;

/**
 * Builds the island in code when the game starts — terrain, sea, sky, sun and moon — and turns the
 * day into night and back. Nothing here needs a level made in the editor.
 */
UCLASS()
class ASIWorld : public AActor
{
	GENERATED_BODY()

public:
	ASIWorld();

	/** Terrain height in cm at a world position. Below zero is under the sea. */
	static float HeightAt(float X, float Y);
	/** The ground's upward direction at a position. */
	static FVector NormalAt(float X, float Y);
	/** Where the player wakes up: a beach on the south shore. */
	static FVector StartLocation();
	/** The island's shore is roughly this far from the centre. */
	static constexpr float IslandRadius = 150000.f;

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** 0 at midnight, 0.25 dawn, 0.5 noon, 0.75 dusk. */
	float TimeOfDay = 0.3f;
	int32 Day = 1;
	/** Seconds one whole day takes. */
	float DayLength = 600.f;
	bool IsNight() const { return TimeOfDay < 0.23f || TimeOfDay > 0.77f; }
	/** 1 in full daylight, 0 at night, in between at dawn and dusk. */
	float Daylight() const;
	/** "第 2 天　14:30" */
	FString ClockText() const;

	/** Set by the storm: how much of its darkness the player is in, 0 to 1. */
	float StormGloom = 0.f;

private:
	void BuildSky();
	void BuildOcean();
	void BuildTerrain();

	UPROPERTY()
	TObjectPtr<UProceduralMeshComponent> Terrain;
	UPROPERTY()
	TObjectPtr<UDirectionalLightComponent> Sun;
	UPROPERTY()
	TObjectPtr<UDirectionalLightComponent> Moon;
	UPROPERTY()
	TObjectPtr<USkyLightComponent> SkyLight;
	UPROPERTY()
	TObjectPtr<UExponentialHeightFogComponent> Fog;
	float Gloom = 0.f;
};
