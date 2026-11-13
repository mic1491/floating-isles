#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "SITypes.h"
#include "SIBuilding.h"
#include "SICharacter.generated.h"

class USpringArmComponent;
class UCameraComponent;
class UStaticMeshComponent;
class USIAnimInstance;
class UAnimSequenceBase;
class ASIResources;
class ASIWorld;
class ASIStorm;

/** A line in the pickup feed at the side of the screen. */
struct FFeedLine
{
	FString Text;
	FLinearColor Colour;
	float Age = 0.f;
};

/**
 * The castaway. Walks, runs and jumps about the island; swings at trees, rocks, bushes and storm
 * creatures; carries what it gathers; crafts tools; and builds. Keeps an eye on health, hunger,
 * warmth and stamina. Input is read straight from the keyboard, mouse and gamepad every frame.
 */
UCLASS()
class ASICharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ASICharacter();
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Hurts the player. From is where the blow came from (for the camera kick). */
	void Hurt(float Amount, const FVector& From);
	bool IsDead() const { return DeadTime >= 0.f; }

	// ---- for the HUD and the story ----
	float Health = 100.f, Hunger = 100.f, Warmth = 100.f, Stamina = 100.f;
	int32 Items[NumItems] = {};
	int32 Gathered[NumItems] = {};       // everything ever picked up
	bool Owned[NumCrafts] = {};
	int32 Bandages = 0;
	bool bBuilding = false;
	bool bCrafting = false;
	EPiece Selected = EPiece::Floor;
	FPlacement Preview;
	bool bHavePreview = false;
	float HurtFlash = 0.f;
	bool bSheltered = false;
	bool bNearFire = false;
	bool bInStorm = false;
	TArray<FFeedLine> Feed;
	FString Notice;
	float NoticeTime = 0.f;
	float DeadTime = -1.f;
	float Age = 0.f;

	/** For the -demo run: a full pack and every tool. */
	void DebugGive();
	bool CanAfford(const FCost& Cost) const;
	void Say(const FString& Text, float Seconds = 3.f);

private:
	void ReadInput(float Dt);
	void UpdateStats(float Dt);
	void UpdateBuilding();
	void Swing();
	void Land();
	void Craft(ECraft What);
	void Spend(const FCost& Cost);
	void Gain(EItem Item, int32 Amount);
	void Respawn();
	void RefreshTool();
	FVector AimPoint() const;

	UPROPERTY()
	TObjectPtr<USpringArmComponent> Arm;
	UPROPERTY()
	TObjectPtr<UCameraComponent> Camera;
	UPROPERTY()
	TObjectPtr<UStaticMeshComponent> Handle;
	UPROPERTY()
	TObjectPtr<UStaticMeshComponent> Head;
	UPROPERTY()
	TArray<TObjectPtr<UAnimSequenceBase>> Swings;
	UPROPERTY()
	TObjectPtr<UAnimSequenceBase> Death;
	UPROPERTY()
	TObjectPtr<ASIResources> Resources;
	UPROPERTY()
	TObjectPtr<ASIBuilding> Building;
	UPROPERTY()
	TObjectPtr<ASIWorld> World;
	UPROPERTY()
	TObjectPtr<ASIStorm> Storm;

	float SwingTimer = -1.f;     // counts down to the moment the blow lands
	float SwingCooldown = 0.f;
	int32 SwingIndex = 0;
	float Kick = 0.f;
	FVector KickDir = FVector::ZeroVector;
	bool bSprinting = false;
	bool bWasInStorm = false;
	float ColdTimer = 0.f;
};
