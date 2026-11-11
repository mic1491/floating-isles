#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "DragonGameMode.generated.h"

/** Puts the player on the dragon and creates the world when a level starts. */
UCLASS()
class ADragonGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ADragonGameMode();
	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
};
