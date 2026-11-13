#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "DragonHUD.generated.h"

class ADragonProps;
class ADragonStory;
class ADragonWorld;

/**
 * Everything drawn over the picture: flight readings, the fire gauge, the story's objective,
 * chapter titles and spoken lines, and the cinema bars during scenes. The text is Chinese and
 * drawn with the engine's own interface font, which carries the characters it needs.
 */
UCLASS()
class ADragonHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	/** Draws one piece of text with a soft shadow; centred on X when asked. */
	void Say(const FString& Text, float X, float Y, int32 Size, const FLinearColor& Colour, bool bCentre = false);

	UPROPERTY()
	TObjectPtr<ADragonWorld> World;
	UPROPERTY()
	TObjectPtr<ADragonProps> Props;
	UPROPERTY()
	TObjectPtr<ADragonStory> Story;
};
