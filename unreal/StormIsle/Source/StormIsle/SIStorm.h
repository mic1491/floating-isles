#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SIStorm.generated.h"

class UProceduralMeshComponent;
class UStaticMeshComponent;
class UPointLightComponent;
class UMaterialInstanceDynamic;
class ASIWorld;
class ASIResources;
class ASIBuilding;
class ASIEnemy;

enum class EStormPhase : uint8 { Calm, Warning, Raging };

/**
 * The storms that sweep the island. After a calm spell a warning is given, then a towering wall of
 * violet cloud rolls in across the player's position, passes over and moves on. Inside it the world
 * goes dark, lightning strikes near the player, the cold bites and storm wraiths come out; only a
 * roof overhead (or the beacon's light) keeps it off. It leaves storm crystals in its wake.
 * At night a few wraiths roam even without a storm.
 */
UCLASS()
class ASIStorm : public AActor
{
	GENERATED_BODY()

public:
	ASIStorm();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	EStormPhase Phase = EStormPhase::Calm;
	/** Seconds until the next phase. */
	float PhaseLeft = 0.f;
	int32 StormsPassed = 0;

	/** Whether P is inside the storm right now. */
	bool IsInside(const FVector& P) const;
	/** Where the storm is coming from, as a direction from the player (for the warning). */
	FVector2D ApproachDirection() const { return Dir * -1.f; }
	FVector2D Centre() const { return Pos; }
	float Radius() const { return R; }
	/** Brings the next storm forward so it starts after Seconds (never later than already planned). */
	void BringForward(float Seconds);
	/** For the -demo run: a storm already raging, with the player just inside its edge. */
	void DebugStartNear();
	void DebugFinish() { Travelled = Journey; }
	/** Inside this distance of the beacon the storm has no power. */
	static constexpr float BeaconReach = 6000.f;

	/** Lightning about to strike: where, and how long until it does (for the warning on the ground). */
	struct FStrike
	{
		FVector Where;
		float Left;
		UStaticMeshComponent* Mark;
	};
	TArray<FStrike> Strikes;

private:
	void BuildWall();
	void StartStorm();
	void EndStorm();
	void TickRaging(float Dt);
	void TickWraiths(float Dt);
	void Lightning(const FVector& Where);
	bool Protected(const FVector& P) const;

	UPROPERTY()
	TObjectPtr<UProceduralMeshComponent> Wall;
	UPROPERTY()
	TObjectPtr<UProceduralMeshComponent> InnerWall;
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> WallMat;
	UPROPERTY()
	TObjectPtr<UStaticMeshComponent> Bolt;
	UPROPERTY()
	TObjectPtr<UPointLightComponent> Flash;
	UPROPERTY()
	TArray<TObjectPtr<UStaticMeshComponent>> MarkPool;
	UPROPERTY()
	TArray<TObjectPtr<ASIEnemy>> Wraiths;
	UPROPERTY()
	TObjectPtr<ASIWorld> World;
	UPROPERTY()
	TObjectPtr<ASIResources> Resources;
	UPROPERTY()
	TObjectPtr<ASIBuilding> Building;

	FVector2D Pos = FVector2D::ZeroVector;    // centre of the storm
	FVector2D Dir = FVector2D(1.f, 0.f);       // which way it travels
	float R = 26000.f;
	float Travelled = 0.f, Journey = 0.f;
	float StrikeTimer = 3.f;
	float BoltTime = 0.f;
	float SpawnTimer = 5.f;
	float Clock = 0.f;
	TArray<FVector2D> Path;    // where the storm passed near the player, for leaving crystals
};
