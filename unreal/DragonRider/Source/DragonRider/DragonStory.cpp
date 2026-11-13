#include "DragonStory.h"
#include "DragonPawn.h"
#include "DragonProps.h"
#include "DragonWorld.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"

namespace
{
	enum class EGoal : uint8 { Rings, Lanterns, Trees, HousesAfterLanding, AllRings };

	struct FStoryLine
	{
		const TCHAR* Speaker; // empty for the narrator
		const TCHAR* Text;
		float Seconds;
		int32 Shot;           // camera shot the dragon holds, see ADragonPawn::SetCutsceneShot
	};

	struct FChapter
	{
		const TCHAR* Title;
		const TCHAR* Objective; // {0} and {1} are filled with progress and the amount needed
		EGoal Goal;
		int32 Count;
		TArray<FStoryLine> Outro; // spoken when the goal is reached
	};

	// Spoken over the opening scene on the mountainside.
	const TArray<FStoryLine>& OpeningLines()
	{
		static const TArray<FStoryLine> Lines = {
			{ TEXT(""),   TEXT("黑旗軍踏上群島的第七年，最後一頭龍在山上睜開了眼。"), 3.4f, -1 },
			{ TEXT("嵐"), TEXT("燼，他們說龍早就死絕了。"), 2.8f, -1 },
			{ TEXT("嵐"), TEXT("那就讓整片海都聽見——他們錯了。"), 3.2f, -1 },
			{ TEXT("嵐"), TEXT("起來。我們飛。"), 2.6f, -1 },
		};
		return Lines;
	}

	const TArray<FChapter>& Chapters()
	{
		static const TArray<FChapter> All = {
			{ TEXT("第一章　甦醒"), TEXT("順著風痕試飛，穿過光環　{0} / {1}"), EGoal::Rings, 5, {
				{ TEXT("嵐"), TEXT("翅膀還記得怎麼飛。很好。"), 3.2f, 1 },
				{ TEXT("嵐"), TEXT("看見那些紅色的火燈了嗎？那是黑旗軍的警哨。"), 4.0f, 4 },
				{ TEXT("嵐"), TEXT("一盞都別留。"), 2.4f, 0 },
			} },
			{ TEXT("第二章　烽火"), TEXT("按住 F 噴火，燒掉警哨火燈　{0} / {1}"), EGoal::Lanterns, 8, {
				{ TEXT(""),   TEXT("警哨一盞盞熄滅，群島第一次安靜了下來。"), 3.8f, 3 },
				{ TEXT("嵐"), TEXT("他們的補給藏在松林裡。"), 3.0f, 1 },
				{ TEXT("嵐"), TEXT("燒出一條路來，燼。"), 2.6f, 0 },
			} },
			{ TEXT("第三章　焚林"), TEXT("飛低點燃松林，讓火延燒　{0} / {1} 棵"), EGoal::Trees, 400, {
				{ TEXT("嵐"), TEXT("火會自己找路。這是你教我的。"), 3.4f, 2 },
				{ TEXT(""),   TEXT("濃煙之下，黑旗軍的營寨再也藏不住了。"), 3.8f, 3 },
				{ TEXT("嵐"), TEXT("這一次，我們落地。讓他們看清楚你的臉。"), 3.8f, 0 },
			} },
			{ TEXT("第四章　踏地"), TEXT("降落後走近營寨，燒毀營舍　{0} / {1} 間"), EGoal::HousesAfterLanding, 25, {
				{ TEXT(""),   TEXT("黑旗在火裡捲成了灰。"), 3.6f, 0 },
				{ TEXT("嵐"), TEXT("夠了。該回家了，燼。"), 3.0f, 1 },
				{ TEXT("嵐"), TEXT("把剩下的風痕飛完，讓每座島都看見你。"), 3.8f, 3 },
			} },
			{ TEXT("終章　歸途"), TEXT("飛完全部光環　{0} / {1}"), EGoal::AllRings, 0, {
				{ TEXT(""),   TEXT("從那天起，群島的人抬頭時，又能看見龍的影子。"), 4.2f, 3 },
				{ TEXT("嵐"), TEXT("走吧。天空是我們的了。"), 3.4f, 0 },
				{ TEXT(""),   TEXT("——　完　——"), 3.5f, 1 },
			} },
		};
		return All;
	}
}

ADragonStory::ADragonStory()
{
	PrimaryActorTick.bCanEverTick = true;
}

float ADragonStory::TitleAlpha() const
{
	return FMath::Clamp(FMath::Min(TitleTime - 0.2f, 3.6f - TitleTime), 0.f, 1.f);
}

int32 ADragonStory::Progress() const
{
	if (!Chapters().IsValidIndex(Chapter) || !World)
	{
		return 0;
	}
	switch (Chapters()[Chapter].Goal)
	{
	case EGoal::Rings:              return World->NextRing - BaseRings;
	case EGoal::Lanterns:           return World->Burned - BaseLanterns;
	case EGoal::Trees:              return Props ? Props->TreesBurned - BaseTrees : 0;
	case EGoal::HousesAfterLanding: return Props ? Props->HousesBurned - BaseHouses : 0;
	case EGoal::AllRings:           return World->NextRing;
	}
	return 0;
}

void ADragonStory::BeginChapter(int32 Index)
{
	Chapter = Index;
	bScene = false;
	LineSpeaker.Reset();
	LineText.Reset();
	if (!Chapters().IsValidIndex(Index))
	{
		Phase = EPhase::Free;
		ObjectiveText = TEXT("自由飛行");
		return;
	}
	Phase = EPhase::Play;
	TitleText = Chapters()[Index].Title;
	TitleTime = 0.f;
	bLanded = false;
	BaseRings = World ? World->NextRing : 0;
	BaseLanterns = World ? World->Burned : 0;
	BaseTrees = Props ? Props->TreesBurned : 0;
	BaseHouses = Props ? Props->HousesBurned : 0;
}

void ADragonStory::ShowLine(int32 Index)
{
	const TArray<FStoryLine>& Lines = Phase == EPhase::Opening ? OpeningLines() : Chapters()[Chapter].Outro;
	LineIndex = Index;
	LineTime = 0.f;
	LineSpeaker = Lines[Index].Speaker;
	LineText = Lines[Index].Text;
	if (Dragon && Phase == EPhase::Outro)
	{
		Dragon->SetCutsceneShot(Lines[Index].Shot);
	}
}

void ADragonStory::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!Dragon)
	{
		Dragon = Cast<ADragonPawn>(UGameplayStatics::GetPlayerPawn(this, 0));
		for (TActorIterator<ADragonWorld> It(GetWorld()); It; ++It) { World = *It; }
		for (TActorIterator<ADragonProps> It(GetWorld()); It; ++It) { Props = *It; }
		if (!Dragon)
		{
			return;
		}
		// The first lines belong to the opening scene; without that scene the story starts at chapter one.
		if (Dragon->IsIntro())
		{
			Phase = EPhase::Opening;
			bScene = true;
			ShowLine(0);
		}
		else
		{
			BeginChapter(0);
		}
	}
	TitleTime += DeltaSeconds;

	const APlayerController* PC = Cast<APlayerController>(Dragon->GetController());
	const bool bNext = PC && (PC->WasInputKeyJustPressed(EKeys::Enter) || PC->WasInputKeyJustPressed(EKeys::SpaceBar) || PC->WasInputKeyJustPressed(EKeys::Gamepad_FaceButton_Bottom));

	if (Phase == EPhase::Opening)
	{
		LineTime += DeltaSeconds;
		if (!Dragon->IsIntro())
		{
			BeginChapter(0);
		}
		else if (LineTime > OpeningLines()[LineIndex].Seconds)
		{
			if (OpeningLines().IsValidIndex(LineIndex + 1))
			{
				ShowLine(LineIndex + 1);
			}
			else
			{
				LineSpeaker.Reset();
				LineText.Reset();
			}
		}
		return;
	}

	if (Phase == EPhase::Outro)
	{
		const TArray<FStoryLine>& Lines = Chapters()[Chapter].Outro;
		LineTime += DeltaSeconds;
		if (LineTime > Lines[LineIndex].Seconds || (bNext && LineTime > 0.4f))
		{
			if (Lines.IsValidIndex(LineIndex + 1))
			{
				ShowLine(LineIndex + 1);
			}
			else
			{
				Dragon->SetCutsceneShot(-1);
				BeginChapter(Chapter + 1);
			}
		}
		return;
	}

	if (Phase == EPhase::Play)
	{
		const FChapter& C = Chapters()[Chapter];
		// Starting the game with -StoryTest makes every goal already met, to run through the scenes.
		static const bool bTest = FParse::Param(FCommandLine::Get(), TEXT("StoryTest"));
		const int32 Need = bTest ? 0 : C.Goal == EGoal::AllRings ? (World ? World->NumRings() : 0) : C.Count;
		const int32 Have = FMath::Min(Progress(), Need);
		bLanded |= Dragon->IsGrounded();
		const bool bMustLand = C.Goal == EGoal::HousesAfterLanding && !bLanded && !bTest;
		ObjectiveText = bMustLand ? FString(TEXT("飛到島嶼上空，按 G 降落")) : FString::Format(C.Objective, { Have, Need });

		// The scene waits until the dragon is flying or standing, not halfway through a landing.
		if (Have >= Need && !bMustLand && !Dragon->IsIntro() && (Dragon->IsFlying() || Dragon->IsGrounded()))
		{
			Phase = EPhase::Outro;
			bScene = true;
			ObjectiveText.Reset();
			ShowLine(0);
		}
	}
}
