#include "SIQuest.h"
#include "SIBuilding.h"
#include "SICharacter.h"
#include "SIStorm.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"

namespace
{
	enum EStep { Gather, Tool, Fire, Shelter, Weather, Crystals, Beacon, Free };

	struct FStepText { const TCHAR* Goal; const TCHAR* Reached; };
	const FStepText Steps[] = {
		{ TEXT("收集材料：按左鍵敲打樹木、石頭和灌木"), TEXT("材料夠了，來做件工具吧") },
		{ TEXT("按 Tab 打開製作，做一把石斧"), TEXT("有了工具，砍樹快多了") },
		{ TEXT("按 B 進入建造，選「營火」蓋一座營火"), TEXT("火光讓人安心。夜裡靠近它取暖") },
		{ TEXT("蓋一間庇護所：地板、三面牆和屋頂"), TEXT("天邊的雲變成了紫色……") },
		{ TEXT("風暴要來了！躲到屋頂下撐過去"), TEXT("風暴過去了。它在身後留下了發光的水晶") },
		{ TEXT("收集風暴留下的水晶"), TEXT("水晶裡的力量，也許能擋住風暴") },
		{ TEXT("建造風暴信標（B → 5）"), TEXT("信標點亮了！它的光芒能擋開風暴") },
		{ TEXT("自由探索與建造"), TEXT("") },
	};
}

ASIQuest::ASIQuest()
{
	PrimaryActorTick.bCanEverTick = true;
}

FString ASIQuest::Goal() const
{
	return Steps[FMath::Min(Step, int32(Free))].Goal;
}

bool ASIQuest::IsFinished() const
{
	return Step >= Free;
}

FString ASIQuest::Progress() const
{
	const ASICharacter* P = Cast<ASICharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!P)
	{
		return FString();
	}
	switch (Step)
	{
	case Gather:
		return FString::Printf(TEXT("木材 %d/5　石頭 %d/3　纖維 %d/2"),
			FMath::Min(P->Gathered[int32(EItem::Wood)], 5), FMath::Min(P->Gathered[int32(EItem::Stone)], 3), FMath::Min(P->Gathered[int32(EItem::Fiber)], 2));
	case Shelter:
		return Building ? FString::Printf(TEXT("地板 %d/1　牆 %d/3　屋頂 %d/1"),
			FMath::Min(Building->Count(EPiece::Floor), 1), FMath::Min(Building->Count(EPiece::Wall), 3), FMath::Min(Building->Count(EPiece::Roof), 1)) : FString();
	case Weather:
		if (Storm && Storm->Phase == EStormPhase::Warning)
		{
			return FString::Printf(TEXT("風暴將在 %d 秒後到來"), FMath::CeilToInt(Storm->PhaseLeft));
		}
		if (Storm && Storm->Phase == EStormPhase::Calm)
		{
			return FString::Printf(TEXT("風暴將在 %d 秒後成形"), FMath::CeilToInt(Storm->PhaseLeft));
		}
		return P->bSheltered ? TEXT("待在屋頂下") : TEXT("快回到屋頂下！");
	case Crystals:
		return FString::Printf(TEXT("風暴水晶 %d/5"), FMath::Min(P->Items[int32(EItem::Crystal)], 5));
	case Beacon:
		return FString::Printf(TEXT("需要 %s"), *Isle::CostText(Isle::PieceCost(EPiece::Beacon)));
	default:
		return FString();
	}
}

bool ASIQuest::Done(const ASICharacter* P) const
{
	switch (Step)
	{
	case Gather:
		return P->Gathered[int32(EItem::Wood)] >= 5 && P->Gathered[int32(EItem::Stone)] >= 3 && P->Gathered[int32(EItem::Fiber)] >= 2;
	case Tool:
		return P->Owned[int32(ECraft::Axe)];
	case Fire:
		return Building && Building->Count(EPiece::Campfire) >= 1;
	case Shelter:
		return Building && Building->Count(EPiece::Floor) >= 1 && Building->Count(EPiece::Wall) >= 3 && Building->Count(EPiece::Roof) >= 1;
	case Weather:
		return Storm && Storm->StormsPassed > StormsAtStep;
	case Crystals:
		return P->Items[int32(EItem::Crystal)] >= 5 || (Building && Building->HasBeacon());
	case Beacon:
		return Building && Building->HasBeacon();
	default:
		return false;
	}
}

void ASIQuest::Tick(float Dt)
{
	Super::Tick(Dt);
	Clock += Dt;
	BannerTime -= Dt;
	if (!Building) { TActorIterator<ASIBuilding> It(GetWorld()); Building = It ? *It : nullptr; }
	if (!Storm) { TActorIterator<ASIStorm> It(GetWorld()); Storm = It ? *It : nullptr; }
	const ASICharacter* P = Cast<ASICharacter>(UGameplayStatics::GetPlayerPawn(this, 0));
	if (!P || Step >= Free)
	{
		return;
	}
	// Several goals can be met at once (a player who builds ahead); step through them all.
	while (Step < Free && Done(P))
	{
		Banner = Steps[Step].Reached;
		++Step;
		BannerTime = Banner.IsEmpty() ? 0.f : 5.f;
		if (Step == Weather && Storm)
		{
			// The shelter is up: bring on the first storm soon, if one is not already near.
			StormsAtStep = Storm->StormsPassed;
			Storm->BringForward(25.f);
		}
		if (Step == Weather && Storm && Storm->Phase == EStormPhase::Raging)
		{
			StormsAtStep = Storm->StormsPassed;
		}
	}
}
