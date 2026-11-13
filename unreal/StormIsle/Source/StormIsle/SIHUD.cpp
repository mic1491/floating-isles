#include "SIHUD.h"
#include "SICharacter.h"
#include "SIQuest.h"
#include "SIResources.h"
#include "SIStorm.h"
#include "SIWorld.h"
#include "CanvasItem.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "EngineUtils.h"
#include "Fonts/SlateFontInfo.h"
#include "GameFramework/PlayerController.h"

namespace
{
	const FLinearColor White(1.f, 1.f, 1.f), Gold(1.f, 0.8f, 0.3f), Dim(0.75f, 0.75f, 0.75f),
		Violet(0.78f, 0.55f, 1.f), Bad(1.f, 0.35f, 0.3f), Good(0.5f, 1.f, 0.55f);

	/** A compass word for a direction on the map: +X is east, +Y is south (Unreal's Y points down the map). */
	const TCHAR* Compass(const FVector2D& D)
	{
		static const TCHAR* Names[8] = { TEXT("東"), TEXT("東南"), TEXT("南"), TEXT("西南"), TEXT("西"), TEXT("西北"), TEXT("北"), TEXT("東北") };
		const float A = FMath::RadiansToDegrees(FMath::Atan2(D.Y, D.X));
		return Names[(FMath::RoundToInt(A / 45.f) + 8) % 8];
	}
}

void ASIHUD::Say(const FString& Text, float X, float Y, int32 Size, const FLinearColor& Colour, bool bCentre)
{
	FCanvasTextItem Item(FVector2D(X, Y), FText::FromString(Text), FSlateFontInfo(GEngine->GetMediumFont(), Size), Colour);
	Item.EnableShadow(FLinearColor(0.f, 0.f, 0.f, 0.85f * Colour.A));
	Item.bCentreX = bCentre;
	Canvas->DrawItem(Item);
}

void ASIHUD::Bar(const TCHAR* Label, float X, float Y, float Value, const FLinearColor& Colour)
{
	Say(Label, X, Y - 3.f, 15, White);
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.5f), X + 48.f, Y, 204.f, 14.f);
	const FLinearColor C = Value < 25.f ? FMath::Lerp(Colour, Bad, 0.5f + 0.5f * FMath::Sin(GetWorld()->GetTimeSeconds() * 8.f)) : Colour;
	DrawRect(C, X + 50.f, Y + 2.f, 200.f * FMath::Clamp(Value / 100.f, 0.f, 1.f), 10.f);
}

void ASIHUD::Panel(float X, float Y, float W, float H, float Alpha)
{
	DrawRect(FLinearColor(0.02f, 0.02f, 0.03f, Alpha), X, Y, W, H);
}

void ASIHUD::DrawHUD()
{
	Super::DrawHUD();
	if (!Canvas)
	{
		return;
	}
	if (!Quest) { TActorIterator<ASIQuest> It(GetWorld()); Quest = It ? *It : nullptr; }
	if (!Storm) { TActorIterator<ASIStorm> It(GetWorld()); Storm = It ? *It : nullptr; }
	if (!World) { TActorIterator<ASIWorld> It(GetWorld()); World = It ? *It : nullptr; }
	if (!Resources) { TActorIterator<ASIResources> It(GetWorld()); Resources = It ? *It : nullptr; }
	const ASICharacter* P = Cast<ASICharacter>(GetOwningPawn());
	if (!P)
	{
		return;
	}
	const float W = Canvas->SizeX, H = Canvas->SizeY;

	// ---- tints over the whole picture ----
	if (World && World->StormGloom > 0.01f)
	{
		DrawRect(FLinearColor(0.25f, 0.05f, 0.4f, World->StormGloom * 0.12f), 0, 0, W, H);
	}
	if (P->HurtFlash > 0.01f)
	{
		const float A = P->HurtFlash * 0.4f;
		const float E = H * 0.12f;
		DrawRect(FLinearColor(0.6f, 0.f, 0.f, A), 0, 0, W, E);
		DrawRect(FLinearColor(0.6f, 0.f, 0.f, A), 0, H - E, W, E);
		DrawRect(FLinearColor(0.6f, 0.f, 0.f, A), 0, E, E, H - 2 * E);
		DrawRect(FLinearColor(0.6f, 0.f, 0.f, A), W - E, E, E, H - 2 * E);
	}
	if (P->IsDead())
	{
		DrawRect(FLinearColor(0.f, 0.f, 0.f, FMath::Min(P->DeadTime * 0.4f, 0.75f)), 0, 0, W, H);
		Say(TEXT("你倒下了……"), W * 0.5f, H * 0.4f, 40, Bad, true);
		return;
	}

	// ---- the opening title ----
	if (P->Age < 7.f)
	{
		const float T = P->Age;
		const float A = FMath::Clamp(FMath::Min(T - 0.3f, 6.5f - T), 0.f, 1.f);
		Say(TEXT("風　暴　之　島"), W * 0.5f, H * 0.22f, 60, FLinearColor(Gold.R, Gold.G, Gold.B, A), true);
		Say(TEXT("你在一片陌生的海灘上醒來。天邊的雲，不太對勁。"), W * 0.5f, H * 0.22f + 82.f, 20, FLinearColor(1, 1, 1, A * 0.9f), true);
	}

	// ---- survival bars ----
	Panel(24.f, 24.f, 280.f, 128.f, 0.35f);
	Bar(TEXT("生命"), 36.f, 38.f, P->Health, FLinearColor(0.85f, 0.15f, 0.12f));
	Bar(TEXT("飢餓"), 36.f, 66.f, P->Hunger, FLinearColor(0.95f, 0.55f, 0.15f));
	Bar(TEXT("體溫"), 36.f, 94.f, P->Warmth, FLinearColor(0.3f, 0.75f, 1.f));
	Bar(TEXT("體力"), 36.f, 122.f, P->Stamina, FLinearColor(0.95f, 0.88f, 0.3f));
	FString State;
	if (P->bInStorm) State += TEXT("風暴中　");
	if (P->bSheltered) State += TEXT("有屋頂遮蔽　");
	if (P->bNearFire) State += TEXT("火旁取暖");
	if (!State.IsEmpty())
	{
		Say(State, 36.f, 160.f, 15, P->bInStorm && !P->bSheltered ? Violet : Good);
	}

	// ---- clock and weather ----
	if (World)
	{
		Say(World->ClockText() + (World->IsNight() ? TEXT("　夜") : TEXT("")), W - 36.f - 300.f, 30.f, 18, White);
	}
	if (Storm)
	{
		FString Weather = TEXT("天氣平靜");
		FLinearColor C = Dim;
		switch (Storm->Phase)
		{
		case EStormPhase::Calm:
			if (Storm->PhaseLeft < 90.f)
			{
				Weather = TEXT("空氣越來越沉悶……");
				C = Violet;
			}
			break;
		case EStormPhase::Warning:
			Weather = FString::Printf(TEXT("風暴從%s方逼近　%d 秒"), Compass(Storm->ApproachDirection()), FMath::CeilToInt(Storm->PhaseLeft));
			C = Violet;
			break;
		case EStormPhase::Raging:
			Weather = P->bInStorm ? TEXT("風暴肆虐中") : TEXT("風暴正在掃過島嶼");
			C = Violet;
			break;
		}
		Say(Weather, W - 36.f - 300.f, 56.f, 17, C);
	}

	// ---- the goal ----
	if (Quest && P->Age > 3.f)
	{
		Panel(W * 0.5f - 300.f, 20.f, 600.f, 62.f, 0.35f);
		Say(Quest->Goal(), W * 0.5f, 28.f, 20, Gold, true);
		const FString Prog = Quest->Progress();
		if (!Prog.IsEmpty())
		{
			Say(Prog, W * 0.5f, 56.f, 15, White, true);
		}
		if (Quest->BannerTime > 0.f)
		{
			const float A = FMath::Clamp(Quest->BannerTime, 0.f, 1.f);
			Say(Quest->Banner, W * 0.5f, H * 0.3f, 28, FLinearColor(1, 1, 1, A), true);
		}
		if (Quest->IsFinished() && Quest->BannerTime > 0.f)
		{
			Say(TEXT("— 第一章完 —"), W * 0.5f, H * 0.3f + 46.f, 22, FLinearColor(Gold.R, Gold.G, Gold.B, FMath::Clamp(Quest->BannerTime, 0.f, 1.f)), true);
		}
	}

	if (P->NoticeTime > 0.f && !P->Notice.IsEmpty())
	{
		Say(P->Notice, W * 0.5f, H * 0.64f, 20, FLinearColor(1, 1, 1, FMath::Clamp(P->NoticeTime * 2.f, 0.f, 1.f)), true);
	}

	// ---- crosshair ----
	DrawRect(FLinearColor(1, 1, 1, 0.8f), W * 0.5f - 2.f, H * 0.5f - 2.f, 4.f, 4.f);

	// ---- the nearest storm crystal, when crystals are wanted ----
	FVector Crystal;
	if (Resources && Quest && Quest->Step >= 5 && Resources->NearestCrystal(P->GetActorLocation(), Crystal))
	{
		const float Dist = FVector::Dist(Crystal, P->GetActorLocation());
		const FVector S = Project(Crystal + FVector(0, 0, 150.f));
		if (S.Z > 0.f && Dist < 12000.f)
		{
			Say(FString::Printf(TEXT("◆ %d m"), FMath::RoundToInt(Dist / 100.f)), S.X, S.Y, 15, Violet, true);
		}
	}

	// ---- pickup feed ----
	for (int32 i = 0; i < P->Feed.Num(); ++i)
	{
		const FFeedLine& L = P->Feed[i];
		const float A = FMath::Clamp(4.f - L.Age, 0.f, 1.f);
		Say(L.Text, W - 230.f, H * 0.42f + i * 26.f, 18, FLinearColor(L.Colour.R, L.Colour.G, L.Colour.B, A));
	}

	// ---- what is carried ----
	{
		const float BoxW = 104.f, Y = H - 88.f;
		const float X0 = W * 0.5f - BoxW * NumItems * 0.5f;
		for (int32 i = 0; i < NumItems; ++i)
		{
			Panel(X0 + i * BoxW + 2.f, Y, BoxW - 4.f, 40.f, 0.45f);
			Say(FString::Printf(TEXT("%s %d"), Isle::ItemName(EItem(i)), P->Items[i]), X0 + i * BoxW + BoxW * 0.5f, Y + 10.f, 16,
				EItem(i) == EItem::Crystal ? Violet : White, true);
		}
		FString Tools;
		for (int32 i = 0; i < NumCrafts - 1; ++i)
		{
			if (P->Owned[i])
			{
				Tools += FString(Isle::CraftName(ECraft(i))) + TEXT("　");
			}
		}
		if (P->Bandages > 0)
		{
			Tools += FString::Printf(TEXT("繃帶 ×%d"), P->Bandages);
		}
		if (!Tools.IsEmpty())
		{
			Say(Tools, W * 0.5f, Y - 26.f, 15, Gold, true);
		}
	}

	// ---- crafting ----
	if (P->bCrafting)
	{
		const float PW = 640.f, PH = 60.f + NumCrafts * 46.f;
		const float X = W * 0.5f - PW * 0.5f, Y = H * 0.5f - PH * 0.5f;
		Panel(X, Y, PW, PH, 0.75f);
		Say(TEXT("製作　（按數字鍵製作，Tab 關閉）"), W * 0.5f, Y + 14.f, 20, Gold, true);
		for (int32 i = 0; i < NumCrafts; ++i)
		{
			const ECraft C = ECraft(i);
			const float RY = Y + 54.f + i * 46.f;
			const bool bHave = C != ECraft::Bandage && P->Owned[i];
			const bool bCan = P->CanAfford(Isle::CraftCost(C));
			const FLinearColor Col = bHave ? Dim : (bCan ? Good : Bad);
			Say(FString::Printf(TEXT("%d　%s"), i + 1, Isle::CraftName(C)), X + 24.f, RY, 19, bHave ? Dim : White);
			Say(bHave ? FString(TEXT("已擁有")) : Isle::CostText(Isle::CraftCost(C)), X + 190.f, RY + 2.f, 16, Col);
			Say(Isle::CraftNote(C), X + 400.f, RY + 2.f, 14, Dim);
		}
	}

	// ---- building ----
	if (P->bBuilding)
	{
		const float BoxW = 150.f, Y = H - 196.f;
		const float X0 = W * 0.5f - BoxW * NumPieces * 0.5f;
		for (int32 i = 0; i < NumPieces; ++i)
		{
			const EPiece Pc = EPiece(i);
			const bool bSel = P->Selected == Pc;
			Panel(X0 + i * BoxW + 3.f, Y, BoxW - 6.f, 64.f, bSel ? 0.8f : 0.4f);
			if (bSel)
			{
				DrawRect(Gold, X0 + i * BoxW + 3.f, Y, BoxW - 6.f, 3.f);
			}
			Say(FString::Printf(TEXT("%d %s"), i + 1, Isle::PieceName(Pc)), X0 + i * BoxW + BoxW * 0.5f, Y + 8.f, 17, bSel ? Gold : White, true);
			Say(Isle::CostText(Isle::PieceCost(Pc)), X0 + i * BoxW + BoxW * 0.5f, Y + 36.f, 13, P->CanAfford(Isle::PieceCost(Pc)) ? Good : Bad, true);
		}
		if (P->bHavePreview && !P->Preview.bValid)
		{
			Say(P->Preview.Why, W * 0.5f, H * 0.5f + 30.f, 17, Bad, true);
		}
		Say(TEXT("建造中：左鍵放置　1–5 或滾輪選擇　B 結束"), W * 0.5f, Y - 28.f, 15, White, true);
	}

	Say(TEXT("WASD 移動　Shift 跑　空白鍵 跳　左鍵 採集/攻擊　Tab 製作　B 建造　E 吃莓果　H 繃帶　Esc 離開"), 30.f, H - 30.f, 13, FLinearColor(1, 1, 1, 0.75f));
}
