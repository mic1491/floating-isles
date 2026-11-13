#include "SIGameMode.h"
#include "SIBuilding.h"
#include "SICharacter.h"
#include "SIDemo.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "SIHUD.h"
#include "SIQuest.h"
#include "SIResources.h"
#include "SIStorm.h"
#include "SIWorld.h"
#include "Engine/World.h"

ASIGameMode::ASIGameMode()
{
	DefaultPawnClass = ASICharacter::StaticClass();
	HUDClass = ASIHUD::StaticClass();
}

void ASIGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);
	// In this order: each later one looks up the ones before it when it begins.
	UWorld* W = GetWorld();
	W->SpawnActor<ASIWorld>(FVector::ZeroVector, FRotator::ZeroRotator);
	W->SpawnActor<ASIResources>(FVector::ZeroVector, FRotator::ZeroRotator);
	W->SpawnActor<ASIBuilding>(FVector::ZeroVector, FRotator::ZeroRotator);
	W->SpawnActor<ASIStorm>(FVector::ZeroVector, FRotator::ZeroRotator);
	W->SpawnActor<ASIQuest>(FVector::ZeroVector, FRotator::ZeroRotator);
	if (FParse::Param(FCommandLine::Get(), TEXT("demo")))
	{
		W->SpawnActor<ASIDemo>(FVector::ZeroVector, FRotator::ZeroRotator);
	}
}
