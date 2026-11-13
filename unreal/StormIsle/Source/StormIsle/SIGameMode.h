#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "SIGameMode.generated.h"

/** Creates the island, its resources, the builder, the storms and the story when a level starts. */
UCLASS()
class ASIGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ASIGameMode();
	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
};
