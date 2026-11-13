#include "SIDemo.h"
#include "SIBuilding.h"
#include "SICharacter.h"
#include "SIStorm.h"
#include "SIWorld.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetSystemLibrary.h"
#include "Misc/Paths.h"
#include "UnrealClient.h"

namespace
{
	template <typename T>
	T* Find(UWorld* W)
	{
		TActorIterator<T> It(W);
		return It ? *It : nullptr;
	}
}

ASIDemo::ASIDemo()
{
	PrimaryActorTick.bCanEverTick = true;
}

void ASIDemo::Shot(const TCHAR* Name)
{
	const FString Path = FPaths::ProjectSavedDir() / TEXT("Demo") / FString(Name) + TEXT(".png");
	FScreenshotRequest::RequestScreenshot(FPaths::ConvertRelativePathToFull(Path), true, false);
	UE_LOG(LogTemp, Display, TEXT("Demo shot %s"), *Path);
}

void ASIDemo::Look(float Yaw, float Pitch)
{
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
	{
		PC->SetControlRotation(FRotator(Pitch, Yaw, 0.f));
	}
}

void ASIDemo::Tick(float Dt)
{
	Super::Tick(Dt);
	Clock += Dt;
	UWorld* W = GetWorld();
	ASICharacter* P = Cast<ASICharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	ASIBuilding* B = Find<ASIBuilding>(W);
	ASIStorm* S = Find<ASIStorm>(W);
	ASIWorld* Wd = Find<ASIWorld>(W);
	if (!P || !B || !S || !Wd)
	{
		return;
	}
	P->Health = 100.f;    // the demo is for looking, not dying

	// Each step: when it happens, and what it does.
	struct FStep { float At; TFunction<void()> Do; };
	const FVector Home = ASIWorld::StartLocation();
	const TArray<FStep> Steps = {
		{ 7.0f, [&] { Shot(TEXT("01_start")); } },
		{ 8.0f, [&] {
			P->DebugGive();
			// A hut a few metres north of the player: floor, three walls, roof, and a fire by the door.
			const FVector Aim = Home + FVector(-900.f, 900.f, 0.f);
			P->SetActorLocation(Aim + FVector(0.f, -550.f, 150.f));
			auto Put = [&](EPiece Piece, const FVector& At)
			{
				FPlacement Pl = B->Plan(Piece, At, P->GetActorLocation(), 90.f);
				UE_LOG(LogTemp, Display, TEXT("Demo place %s: %s %s"), Isle::PieceName(Piece), Pl.bValid ? TEXT("ok") : TEXT("refused"), *Pl.Why);
				if (Pl.bValid) B->Place(Pl);
			};
			Put(EPiece::Floor, Aim);
			const FVector C = FVector(FMath::FloorToFloat(Aim.X / Isle::Cell) + 0.5f, FMath::FloorToFloat(Aim.Y / Isle::Cell) + 0.5f, 0.f) * Isle::Cell;
			Put(EPiece::Wall, C + FVector(-Isle::Cell * 0.45f, 0, 0));
			Put(EPiece::Wall, C + FVector(Isle::Cell * 0.45f, 0, 0));
			Put(EPiece::Wall, C + FVector(0, Isle::Cell * 0.45f, 0));
			Put(EPiece::Roof, C);
			Put(EPiece::Campfire, C + FVector(250.f, -380.f, 0));
			Look(75.f, -12.f);
		} },
		{ 10.0f, [&] { Shot(TEXT("02_shelter")); } },
		{ 10.5f, [&] { P->bBuilding = true; P->Selected = EPiece::Wall; Look(30.f, -20.f); } },
		{ 12.0f, [&] { Shot(TEXT("03_build_mode")); } },
		{ 12.5f, [&] { P->bBuilding = false; P->bCrafting = true; } },
		{ 13.5f, [&] { Shot(TEXT("04_craft_menu")); } },
		{ 14.0f, [&] { P->bCrafting = false; Wd->TimeOfDay = 0.93f; Look(75.f, -8.f); } },
		{ 16.0f, [&] { Shot(TEXT("05_night")); } },
		{ 16.5f, [&] { Wd->TimeOfDay = 0.4f; S->BringForward(0.f); } },
		{ 18.0f, [&] { const FVector2D D = S->ApproachDirection(); Look(FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)), 5.f); } },
		{ 21.0f, [&] { Shot(TEXT("06_storm_coming")); } },
		{ 22.0f, [&] { S->DebugStartNear(); const FVector2D D = S->ApproachDirection(); Look(FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X)) + 180.f, 2.f); } },
		{ 25.0f, [&] { Shot(TEXT("07_in_storm")); } },
		{ 34.0f, [&] { Look(P->GetActorRotation().Yaw + 180.f, -10.f); Shot(TEXT("08_wraiths")); } },
		{ 37.0f, [&] { Shot(TEXT("09_wraiths_b")); } },
		{ 38.0f, [&] { S->DebugFinish(); } },
		{ 41.0f, [&] { Look(0.f, -25.f); Shot(TEXT("10_crystals")); } },
		{ 42.0f, [&] {
			FPlacement Pl = B->Plan(EPiece::Beacon, P->GetActorLocation() + FVector(600.f, 0, 0), P->GetActorLocation(), 0.f);
			UE_LOG(LogTemp, Display, TEXT("Demo place beacon: %s %s"), Pl.bValid ? TEXT("ok") : TEXT("refused"), *Pl.Why);
			if (Pl.bValid) B->Place(Pl);
			Look(0.f, 0.f);
		} },
		{ 45.0f, [&] { Shot(TEXT("11_beacon")); } },
		{ 47.0f, [&] { UKismetSystemLibrary::QuitGame(this, nullptr, EQuitPreference::Quit, false); } },
	};
	while (Next < Steps.Num() && Clock >= Steps[Next].At)
	{
		Steps[Next++].Do();
	}
}
