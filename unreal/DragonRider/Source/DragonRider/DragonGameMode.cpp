#include "DragonGameMode.h"
#include "DragonHUD.h"
#include "DragonPawn.h"
#include "DragonProps.h"
#include "DragonStory.h"
#include "DragonWorld.h"
#include "Engine/World.h"

ADragonGameMode::ADragonGameMode()
{
	DefaultPawnClass = ADragonPawn::StaticClass();
	HUDClass = ADragonHUD::StaticClass();
}

void ADragonGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);
	GetWorld()->SpawnActor<ADragonWorld>(FVector::ZeroVector, FRotator::ZeroRotator);
	GetWorld()->SpawnActor<ADragonProps>(FVector::ZeroVector, FRotator::ZeroRotator);
	GetWorld()->SpawnActor<ADragonStory>(FVector::ZeroVector, FRotator::ZeroRotator);
}
