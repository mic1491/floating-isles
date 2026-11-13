#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "SIDemo.generated.h"

/**
 * Started with -demo on the command line: plays through the game's main moments by itself — a
 * shelter going up, the build and craft menus, night, a storm rolling in, wraiths, the crystals it
 * leaves and the beacon — saving a screenshot of each to Saved/Demo, then quits. For checking the
 * game without anyone at the controls.
 */
UCLASS()
class ASIDemo : public AActor
{
	GENERATED_BODY()

public:
	ASIDemo();
	virtual void Tick(float DeltaSeconds) override;

private:
	void Shot(const TCHAR* Name);
	void Look(float Yaw, float Pitch);
	float Clock = 0.f;
	int32 Next = 0;
};
