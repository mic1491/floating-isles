#include "DragonHUD.h"
#include "DragonPawn.h"
#include "DragonWorld.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"

void ADragonHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas)
	{
		return;
	}
	if (!World)
	{
		TActorIterator<ADragonWorld> It(GetWorld());
		World = It ? *It : nullptr;
	}
	const ADragonPawn* Dragon = Cast<ADragonPawn>(GetOwningPawn());
	if (!World || !Dragon)
	{
		return;
	}

	UFont* Font = GEngine->GetMediumFont();
	const FLinearColor White(1.f, 1.f, 1.f), Gold(1.f, 0.75f, 0.1f);
	const float W = Canvas->SizeX, H = Canvas->SizeY;
	const FVector Loc = Dragon->GetActorLocation();

	// cm/s to km/h, and height above the sea in metres.
	DrawText(FString::Printf(TEXT("SPEED  %d km/h"), FMath::RoundToInt(Dragon->GetSpeed() * 0.036f)), White, 40.f, 40.f, Font, 1.6f);
	DrawText(FString::Printf(TEXT("HEIGHT %d m"), FMath::RoundToInt(Loc.Z / 100.f)), White, 40.f, 70.f, Font, 1.6f);
	DrawText(FString::Printf(TEXT("RINGS  %d / %d"), World->NextRing, World->NumRings()), Gold, 40.f, 100.f, Font, 1.6f);
	DrawText(FString::Printf(TEXT("TIME   %.1f s"), World->CourseTime), White, 40.f, 130.f, Font, 1.6f);
	DrawText(FString::Printf(TEXT("BURNED %d / %d"), World->Burned, World->NumTargets()), FLinearColor(1.f, 0.35f, 0.1f), 40.f, 160.f, Font, 1.6f);

	// Fire fuel bar: orange while ready, grey while it recovers.
	const float Fuel = Dragon->GetFuel();
	DrawText(TEXT("FIRE"), White, 40.f, 196.f, Font, 1.4f);
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.45f), 110.f, 200.f, 204.f, 18.f);
	DrawRect(Fuel > 0.2f ? FLinearColor(1.f, 0.45f, 0.05f) : FLinearColor(0.5f, 0.5f, 0.5f), 112.f, 202.f, 200.f * Fuel, 14.f);

	DrawText(TEXT("W/S or mouse: pitch    A/D or mouse: turn    Space: flap    F / right mouse: fire    Shift: brake    R: restart"), White, 40.f, H - 50.f, Font, 1.2f);

	if (World->bFinished)
	{
		DrawText(FString::Printf(TEXT("COURSE COMPLETE  %.1f s   -   press R to fly again"), World->CourseTime), Gold, W * 0.5f - 330.f, H * 0.3f, Font, 2.2f);
	}
	else if (Dragon->IsTurningBack())
	{
		DrawText(TEXT("Open sea ahead - turning back"), Gold, W * 0.5f - 180.f, H * 0.3f, Font, 1.8f);
	}

	// A marker over the next ring, or an arrow at the screen edge when it is out of view.
	FVector Ring;
	if (World->GetNextRingLocation(Ring))
	{
		const FVector Screen = Project(Ring);
		const float Metres = FVector::Dist(Ring, Loc) / 100.f;
		if (Screen.Z > 0.f && Screen.X > 0.f && Screen.X < W && Screen.Y > 0.f && Screen.Y < H)
		{
			DrawText(FString::Printf(TEXT("%d m"), FMath::RoundToInt(Metres)), Gold, Screen.X - 20.f, Screen.Y - 60.f, Font, 1.3f);
		}
		else if (const APlayerController* PC = GetOwningPlayerController())
		{
			FVector CamLoc;
			FRotator CamRot;
			PC->GetPlayerViewPoint(CamLoc, CamRot);
			const FVector Local = CamRot.UnrotateVector(Ring - CamLoc);
			const FVector2D Dir = FVector2D(Local.Y, -Local.Z).GetSafeNormal();
			const FVector2D P = FVector2D(W, H) * 0.5f + Dir * FMath::Min(W, H) * 0.4f;
			DrawText(FString::Printf(TEXT("RING %d m"), FMath::RoundToInt(Metres)), Gold, P.X - 40.f, P.Y, Font, 1.4f);
		}
	}
}
