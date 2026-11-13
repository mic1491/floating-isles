#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SIQuest.generated.h"

class ASICharacter;
class ASIBuilding;
class ASIStorm;

/**
 * The run of goals that teaches the game and gives it an end: gather, make a tool, light a fire,
 * build a shelter, live through a storm, collect its crystals and raise the beacon that keeps storms
 * away. Also the opening title.
 */
UCLASS()
class ASIQuest : public AActor
{
	GENERATED_BODY()

public:
	ASIQuest();
	virtual void Tick(float DeltaSeconds) override;

	int32 Step = 0;
	/** The goal now, and how far along it is ("木材 3/5"). */
	FString Goal() const;
	FString Progress() const;
	/** A line said when a goal is reached, shown for a few seconds. */
	FString Banner;
	float BannerTime = 0.f;
	float Clock = 0.f;
	bool IsFinished() const;

private:
	bool Done(const ASICharacter* P) const;

	UPROPERTY()
	TObjectPtr<ASIBuilding> Building;
	UPROPERTY()
	TObjectPtr<ASIStorm> Storm;
	int32 StormsAtStep = 0;
};
