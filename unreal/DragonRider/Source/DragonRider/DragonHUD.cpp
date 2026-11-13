#include "DragonHUD.h"
#include "DragonPawn.h"
#include "DragonProps.h"
#include "DragonStory.h"
#include "DragonWorld.h"
#include "CanvasItem.h"
#include "Engine/Canvas.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "Engine/Engine.h"
#include "Fonts/SlateFontInfo.h"

void ADragonHUD::Say(const FString& Text, float X, float Y, int32 Size, const FLinearColor& Colour, bool bCentre)
{
	// The engine's own font object at a chosen size; glyphs it lacks (Chinese) come from the engine's fallback font.
	FCanvasTextItem Item(FVector2D(X, Y), FText::FromString(Text), FSlateFontInfo(GEngine->GetMediumFont(), Size), Colour);
	Item.EnableShadow(FLinearColor(0.f, 0.f, 0.f, 0.85f * Colour.A));
	Item.bCentreX = bCentre;
	Canvas->DrawItem(Item);
}

void ADragonHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas)
	{
		return;
	}
	if (!World) { TActorIterator<ADragonWorld> It(GetWorld()); World = It ? *It : nullptr; }
	if (!Props) { TActorIterator<ADragonProps> It(GetWorld()); Props = It ? *It : nullptr; }
	if (!Story) { TActorIterator<ADragonStory> It(GetWorld()); Story = It ? *It : nullptr; }
	const ADragonPawn* Dragon = Cast<ADragonPawn>(GetOwningPawn());
	if (!World || !Dragon)
	{
		return;
	}

	const float W = Canvas->SizeX, H = Canvas->SizeY;
	const FLinearColor White(1.f, 1.f, 1.f), Gold(1.f, 0.78f, 0.25f), Ember(1.f, 0.42f, 0.12f);
	const bool bScene = Dragon->IsIntro() || Dragon->InCutscene() || (Story && Story->InScene());

	// ---- scenes: cinema bars, the game's title in the opening, and the line being spoken ----
	if (bScene)
	{
		const float Bar = H * 0.11f;
		DrawRect(FLinearColor::Black, 0.f, 0.f, W, Bar);
		DrawRect(FLinearColor::Black, 0.f, H - Bar, W, Bar);
		if (Dragon->IsIntro())
		{
			const float T = Dragon->GetIntroTime();
			const float Fade = FMath::Clamp(FMath::Min(T - 0.4f, 3.3f - T), 0.f, 1.f);
			if (Fade > 0.f)
			{
				Say(TEXT("龍　騎　士"), W * 0.5f, H * 0.20f, 64, FLinearColor(Gold.R, Gold.G, Gold.B, Fade), true);
			}
		}
		if (Story && !Story->Line().IsEmpty())
		{
			const FString Shown = Story->Speaker().IsEmpty() ? Story->Line() : Story->Speaker() + TEXT("：") + Story->Line();
			Say(Shown, W * 0.5f, H - Bar - 62.f, 24, Story->Speaker().IsEmpty() ? FLinearColor(0.85f, 0.88f, 0.95f) : White, true);
		}
		Say(TEXT("空白鍵：跳過"), W - 170.f, H - Bar * 0.68f, 14, FLinearColor(1.f, 1.f, 1.f, 0.7f));
		return;
	}

	// ---- readings ----
	const FVector Loc = Dragon->GetActorLocation();
	Say(FString::Printf(TEXT("速度　%d km/h"), FMath::RoundToInt(Dragon->GetSpeed() * 0.036f)), 40.f, 36.f, 18, White);
	Say(FString::Printf(TEXT("高度　%d m"), FMath::RoundToInt(Loc.Z / 100.f)), 40.f, 66.f, 18, White);
	Say(FString::Printf(TEXT("光環　%d / %d　　%.1f 秒"), World->NextRing, World->NumRings(), World->CourseTime), 40.f, 96.f, 18, Gold);
	Say(FString::Printf(TEXT("火燈　%d / %d"), World->Burned, World->NumTargets()), 40.f, 126.f, 18, Ember);
	if (Props)
	{
		Say(FString::Printf(TEXT("樹木　%d / %d　　營舍　%d / %d"), Props->TreesBurned, Props->NumTrees, Props->HousesBurned, Props->NumHouses), 40.f, 156.f, 18, Ember);
	}

	// Fire gauge: orange while ready, grey while it recovers.
	const float Fuel = Dragon->GetFuel();
	Say(TEXT("龍焰"), 40.f, 190.f, 18, White);
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.45f), 110.f, 196.f, 204.f, 18.f);
	DrawRect(Fuel > 0.2f ? FLinearColor(1.f, 0.45f, 0.05f) : FLinearColor(0.5f, 0.5f, 0.5f), 112.f, 198.f, 200.f * Fuel, 14.f);

	Say(FString::Printf(TEXT("視角：%s"), Dragon->GetViewName()), W - 230.f, 36.f, 16, White);

	// ---- story: what to do now, and the chapter's name when it begins ----
	if (Story)
	{
		if (!Story->Objective().IsEmpty())
		{
			Say(Story->Objective(), W * 0.5f, 34.f, 20, Gold, true);
		}
		const float A = Story->TitleAlpha();
		if (A > 0.f && !Story->Title().IsEmpty())
		{
			Say(Story->Title(), W * 0.5f, H * 0.26f, 46, FLinearColor(1.f, 1.f, 1.f, A), true);
		}
	}

	const TCHAR* Help = Dragon->IsGrounded()
		? TEXT("W 走　Shift 跑　A/D 或滑鼠 轉向　F/右鍵 噴火　空白鍵 起飛　C 視角　R 重來　Esc 離開")
		: TEXT("W/S 或滑鼠 俯仰　A/D 或滑鼠 轉向　空白鍵 拍翅　F/右鍵 噴火　Shift 減速　G 降落　C 視角　R 重來　Esc 離開");
	Say(Help, 40.f, H - 46.f, 14, White);

	if (!Dragon->GetNotice().IsEmpty())
	{
		Say(Dragon->GetNotice(), W * 0.5f, H * 0.36f, 24, Gold, true);
	}
	if (World->bFinished && (!Story || Story->Objective() == TEXT("自由飛行")))
	{
		Say(FString::Printf(TEXT("全程完成　%.1f 秒　　按 R 再飛一次"), World->CourseTime), W * 0.5f, H * 0.44f, 26, Gold, true);
	}
	else if (Dragon->IsTurningBack())
	{
		Say(TEXT("前方是外海，正在折返"), W * 0.5f, H * 0.36f, 22, Gold, true);
	}

	// A marker over the next ring, or a pointer at the screen edge when it is out of view.
	FVector Ring;
	if (World->GetNextRingLocation(Ring))
	{
		const FVector Screen = Project(Ring);
		const int32 Metres = FMath::RoundToInt(FVector::Dist(Ring, Loc) / 100.f);
		if (Screen.Z > 0.f && Screen.X > 0.f && Screen.X < W && Screen.Y > 0.f && Screen.Y < H)
		{
			Say(FString::Printf(TEXT("%d m"), Metres), Screen.X, Screen.Y - 64.f, 16, Gold, true);
		}
		else if (const APlayerController* PC = GetOwningPlayerController())
		{
			FVector CamLoc;
			FRotator CamRot;
			PC->GetPlayerViewPoint(CamLoc, CamRot);
			const FVector Local = CamRot.UnrotateVector(Ring - CamLoc);
			const FVector2D Dir = FVector2D(Local.Y, -Local.Z).GetSafeNormal();
			const FVector2D P = FVector2D(W, H) * 0.5f + Dir * FMath::Min(W, H) * 0.4f;
			Say(FString::Printf(TEXT("光環 %d m"), Metres), P.X, P.Y, 17, Gold, true);
		}
	}
}
