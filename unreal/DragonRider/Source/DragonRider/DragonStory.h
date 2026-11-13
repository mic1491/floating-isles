#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonStory.generated.h"

class ADragonPawn;
class ADragonProps;
class ADragonWorld;

/**
 * The story: five chapters, each with a goal to reach and a short scene of spoken lines when it
 * is done. The chapters and their lines are a table in DragonStory.cpp; this class walks through
 * it, watches the goals, and tells the dragon which camera shot to hold while lines are spoken.
 * The HUD reads what to show from here.
 */
UCLASS()
class ADragonStory : public AActor
{
	GENERATED_BODY()

public:
	ADragonStory();
	virtual void Tick(float DeltaSeconds) override;

	/** True while lines are being spoken and the picture should have cinema bars. */
	bool InScene() const { return bScene; }
	const FString& Speaker() const { return LineSpeaker; }
	const FString& Line() const { return LineText; }
	/** The chapter's name, shown large for a moment when it begins; Alpha fades it in and out. */
	const FString& Title() const { return TitleText; }
	float TitleAlpha() const;
	/** What the player should do now, with progress; empty during scenes. */
	const FString& Objective() const { return ObjectiveText; }

private:
	enum class EPhase : uint8 { Opening, Play, Outro, Free };

	void BeginChapter(int32 Index);
	void ShowLine(int32 Index);
	int32 Progress() const;

	UPROPERTY()
	TObjectPtr<ADragonPawn> Dragon;
	UPROPERTY()
	TObjectPtr<ADragonWorld> World;
	UPROPERTY()
	TObjectPtr<ADragonProps> Props;

	EPhase Phase = EPhase::Opening;
	int32 Chapter = -1;
	int32 LineIndex = 0;
	float LineTime = 0.f;
	float TitleTime = 99.f;
	bool bScene = false;
	bool bLanded = false;
	int32 BaseRings = 0, BaseLanterns = 0, BaseTrees = 0, BaseHouses = 0;

	FString LineSpeaker, LineText, TitleText, ObjectiveText;
};
