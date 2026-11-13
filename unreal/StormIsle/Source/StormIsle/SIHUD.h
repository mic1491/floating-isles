#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "SIHUD.generated.h"

class ASIQuest;
class ASIStorm;
class ASIWorld;
class ASIResources;

/**
 * Everything drawn over the picture: the four survival bars, the clock and the storm's approach,
 * the current goal, what is carried, the crafting and building menus, the pickup feed, and the
 * opening title. All text is Chinese, drawn with the engine's own font and its fallback.
 */
UCLASS()
class ASIHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	void Say(const FString& Text, float X, float Y, int32 Size, const FLinearColor& Colour, bool bCentre = false);
	void Bar(const TCHAR* Label, float X, float Y, float Value, const FLinearColor& Colour);
	void Panel(float X, float Y, float W, float H, float Alpha = 0.5f);

	UPROPERTY()
	TObjectPtr<ASIQuest> Quest;
	UPROPERTY()
	TObjectPtr<ASIStorm> Storm;
	UPROPERTY()
	TObjectPtr<ASIWorld> World;
	UPROPERTY()
	TObjectPtr<ASIResources> Resources;
};
