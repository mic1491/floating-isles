#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "DragonHUD.generated.h"

class ADragonProps;
class ADragonWorld;

/** Speed, height, ring count, course time and the controls, drawn straight onto the screen. */
UCLASS()
class ADragonHUD : public AHUD
{
	GENERATED_BODY()

public:
	virtual void DrawHUD() override;

private:
	UPROPERTY()
	TObjectPtr<ADragonWorld> World;
	UPROPERTY()
	TObjectPtr<ADragonProps> Props;
};
