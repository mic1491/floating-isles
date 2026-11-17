#include "DragonSky.h"
#include "DragonWorld.h"
#include "Camera/CameraComponent.h"
#include "Components/AudioComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyLight.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerController.h"
#include "InputCoreTypes.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Sound/SoundBase.h"

float ADragonSky::RainNow = 0.f;

namespace
{
	const int32 NumDrops = 1800;
	const float RainBox = 2400.f;           // rain falls in a 48 m box round the camera
	const FVector RainWind(350.f, 160.f, -1300.f);
	const float SunLux = 8.f;
	const float MoonLux = 1.0f;
}

ADragonSky::ADragonSky()
{
	PrimaryActorTick.bCanEverTick = true;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	Drops = CreateDefaultSubobject<UInstancedStaticMeshComponent>(TEXT("Drops"));
	Drops->SetupAttachment(RootComponent);
	Drops->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	Drops->SetCastShadow(false);
	Drops->SetUsingAbsoluteLocation(true);
	Drops->SetUsingAbsoluteRotation(true);
	Drops->SetUsingAbsoluteScale(true);
	RainAudio = CreateDefaultSubobject<UAudioComponent>(TEXT("RainAudio"));
	RainAudio->SetupAttachment(RootComponent);
	RainAudio->bAutoActivate = false;
	RainAudio->bIsUISound = true;
}

const TCHAR* ADragonSky::GetWeatherName() const
{
	switch (Weather)
	{
	case EWeather::Cloudy: return TEXT("陰");
	case EWeather::Rain:   return TEXT("雨");
	case EWeather::Storm:  return TEXT("雷雨");
	default:               return TEXT("晴");
	}
}

void ADragonSky::SetWeather(EWeather New)
{
	Weather = New;
	WeatherLeft = FMath::FRandRange(150.f, 300.f);
}

void ADragonSky::Start()
{
	bStarted = true;
	UWorld* W = GetWorld();
	for (TActorIterator<ADirectionalLight> It(W); It; ++It) { if (!Sun) { Sun = *It; } }
	for (TActorIterator<ASkyLight> It(W); It; ++It) { SkyLight = *It; }
	for (TActorIterator<AExponentialHeightFog> It(W); It; ++It) { Fog = *It; }
	for (TActorIterator<AVolumetricCloud> It(W); It; ++It)
	{
		UVolumetricCloudComponent* C = It->FindComponentByClass<UVolumetricCloudComponent>();
		UMaterialInterface* Base = C ? C->Material.LoadSynchronous() : nullptr;
		if (Base)
		{
			Clouds = UMaterialInstanceDynamic::Create(Base, this);
			C->SetMaterial(Clouds);
			CloudCoverage0 = Clouds->K2_GetScalarParameterValue(TEXT("Cloud_GlobalCoverage"));
			CloudDensity0 = Clouds->K2_GetScalarParameterValue(TEXT("Cloud_GlobalDensity"));
		}
	}
	FogDensity0 = Fog ? Fog->GetComponent()->FogDensity : 0.f;

	auto Light = [W](const FLinearColor& Colour, bool bShadows)
	{
		ADirectionalLight* L = W->SpawnActor<ADirectionalLight>(FVector(0, 0, 100000), FRotator(-45.f, 0.f, 0.f));
		L->GetLightComponent()->SetMobility(EComponentMobility::Movable);
		L->GetLightComponent()->SetLightColor(Colour);
		L->GetLightComponent()->SetIntensity(0.f);
		L->GetLightComponent()->SetCastShadows(bShadows);
		return L;
	};
	Moon = Light(FLinearColor(0.55f, 0.65f, 1.f), false);
	// The moon lights the land but not the air: lit by it, the atmosphere would glow daylight blue
	// once the camera has adjusted to the dark, and the night would never look like night.
	if (UDirectionalLightComponent* M = Cast<UDirectionalLightComponent>(Moon->GetLightComponent()))
	{
		M->SetAtmosphereSunLight(false);
	}
	Flash = Light(FLinearColor(0.8f, 0.85f, 1.f), false);

	Drops->SetStaticMesh(LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder")));
	if (UMaterialInterface* M = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Materials/M_Rain.M_Rain"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		Drops->SetMaterial(0, M);
	}
	DropPos.SetNum(NumDrops);
	for (int32 i = 0; i < NumDrops; ++i)
	{
		DropPos[i] = FVector(FMath::FRandRange(-RainBox, RainBox), FMath::FRandRange(-RainBox, RainBox), FMath::FRandRange(-RainBox, RainBox));
		Drops->AddInstance(FTransform(FRotator::ZeroRotator, FVector(0, 0, -5000000.f), FVector(0.01f)), true);
	}
	if (USoundBase* S = LoadObject<USoundBase>(nullptr, TEXT("/Game/Audio/rain_loop.rain_loop"), nullptr, LOAD_NoWarn | LOAD_Quiet))
	{
		RainAudio->SetSound(S);
		RainAudio->SetVolumeMultiplier(0.01f);
		RainAudio->Play();
	}
	Thunder = LoadObject<USoundBase>(nullptr, TEXT("/Game/Audio/thunder.thunder"), nullptr, LOAD_NoWarn | LOAD_Quiet);

	// Starting the game with -Hour=N and -Weather=N (0 clear, 1 cloudy, 2 rain, 3 storm) sets them at once, for checking.
	const TCHAR* Cmd = FCommandLine::Get();
	FParse::Value(Cmd, TEXT("Hour="), Hour);
	int32 StartWeather = 0;
	SetWeather(FParse::Value(Cmd, TEXT("Weather="), StartWeather) ? EWeather(FMath::Clamp(StartWeather, 0, 3)) : EWeather::Clear);
	if (StartWeather > 0)
	{
		const float Targets[4][3] = { { 0, 0, 0 }, { 0.6f, 0, 0 }, { 0.85f, 0.75f, 0 }, { 1, 1, 1 } };
		Overcast = Targets[StartWeather][0];
		Rain = Targets[StartWeather][1];
		Storm = Targets[StartWeather][2];
	}
}

void ADragonSky::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (!bStarted)
	{
		Start();
	}
	const float Dt = FMath::Min(DeltaSeconds, 0.1f);

	// ---- the clock ----
	Hour = FMath::Fmod(Hour + Dt * 24.f / (DayMinutes * 60.f), 24.f);
	FVector Eye = FVector::ZeroVector;
	if (APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0))
	{
		if (PC->WasInputKeyJustPressed(EKeys::H))
		{
			Hour = FMath::Fmod(Hour + 3.f, 24.f);
		}
		if (PC->WasInputKeyJustPressed(EKeys::Y))
		{
			SetWeather(EWeather((int32(Weather) + 1) % 4));
		}
		FRotator Unused;
		PC->GetPlayerViewPoint(Eye, Unused);
	}

	// ---- the weather drifts on by itself every few minutes; clear and cloudy come more often ----
	WeatherLeft -= Dt;
	if (WeatherLeft <= 0.f)
	{
		const float Roll = FMath::FRand();
		SetWeather(Roll < 0.4f ? EWeather::Clear : Roll < 0.7f ? EWeather::Cloudy : Roll < 0.9f ? EWeather::Rain : EWeather::Storm);
	}
	const float Want[4][3] = { { 0, 0, 0 }, { 0.6f, 0, 0 }, { 0.85f, 0.75f, 0 }, { 1, 1, 1 } };
	const float* T = Want[int32(Weather)];
	Overcast = FMath::FInterpConstantTo(Overcast, T[0], Dt, 0.05f);
	Rain = FMath::FInterpConstantTo(Rain, T[1], Dt, 0.05f);
	Storm = FMath::FInterpConstantTo(Storm, T[2], Dt, 0.05f);
	RainNow = Rain;

	UpdateLight(Dt);
	UpdateRain(Dt, Eye);
	UpdateLightning(Dt);
}

void ADragonSky::UpdateLight(float Dt)
{
	// The sun climbs to 65 degrees at noon and is 25 degrees below the horizon at midnight;
	// the moon rides opposite it. The sky's colours at dawn and dusk come from the atmosphere itself.
	const float Angle = 2.f * PI * (Hour - 6.f) / 24.f;
	const float SunUp = 45.f * FMath::Sin(Angle) + 20.f * FMath::Sin(Angle) * FMath::Abs(FMath::Sin(Angle));
	const float Yaw = 35.f + (Hour - 12.f) * 12.f;
	const float Dim = 1.f - 0.95f * Overcast; // under heavy cloud the sun hardly gets through
	if (Sun)
	{
		Sun->SetActorRotation(FRotator(-SunUp, Yaw, 0.f));
		Sun->GetLightComponent()->SetIntensity(SunLux * FMath::SmoothStep(-4.f, 8.f, SunUp) * Dim);
	}
	if (Moon)
	{
		const float MoonUp = FMath::Max(-SunUp * 0.9f, -30.f) + 8.f;
		Moon->SetActorRotation(FRotator(-MoonUp, Yaw + 180.f, 0.f));
		Moon->GetLightComponent()->SetIntensity(MoonLux * FMath::SmoothStep(-2.f, 10.f, MoonUp) * (1.f - 0.85f * Overcast));
	}
	if (SkyLight)
	{
		SkyLight->GetLightComponent()->SetIntensity(1.f - 0.15f * Overcast);
	}
	if (Fog)
	{
		Fog->GetComponent()->SetFogDensity(FogDensity0 * (1.f + 2.5f * Overcast + 5.f * Rain));
	}
	// The camera would otherwise brighten a grey day back to a bright one: hold it darker and duller under cloud.
	if (const APawn* Pawn = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		if (UCameraComponent* Cam = Pawn->FindComponentByClass<UCameraComponent>())
		{
			// At night the camera must not brighten the moonlit land back to daylight, or it never looks dark.
			const float Dark = (1.f - FMath::SmoothStep(-14.f, -2.f, SunUp));
			// so through the night the exposure is held where it is by day, and the moonlit land is properly dim.
			Cam->PostProcessSettings.AutoExposureBias = -0.5f - 1.3f * Overcast * (1.f - Dark);
			Cam->PostProcessSettings.AutoExposureMinBrightness = FMath::Lerp(-0.6f, 0.9f, Dark);
			Cam->PostProcessSettings.bOverride_ColorSaturation = true;
			Cam->PostProcessSettings.ColorSaturation = FVector4(1.f, 1.f, 1.f, 1.f - 0.4f * Overcast - 0.35f * Dark);
		}
	}
	if (Clouds)
	{
		Clouds->SetScalarParameterValue(TEXT("Cloud_GlobalCoverage"), FMath::Lerp(CloudCoverage0, FMath::Max(CloudCoverage0 * 2.2f, CloudCoverage0 + 0.5f), Overcast));
		Clouds->SetScalarParameterValue(TEXT("Cloud_GlobalDensity"), CloudDensity0 * (1.f + 2.f * Overcast));
		Clouds->SetScalarParameterValue(TEXT("StormClouds"), Storm);
	}
}

void ADragonSky::UpdateRain(float Dt, const FVector& Eye)
{
	if (DropPos.Num() == 0)
	{
		return;
	}
	RainAudio->SetVolumeMultiplier(FMath::Max(Rain * (0.6f + 0.4f * Storm), 0.01f));
	// Drops live in a box that moves with the camera; one that falls out of the box comes back in at the top.
	const int32 Showing = FMath::RoundToInt32(NumDrops * Rain);
	const FVector Fall = RainWind * (1.f + 0.4f * Storm);
	const FRotator Slant = (-Fall).Rotation() + FRotator(-90.f, 0.f, 0.f);
	for (int32 i = 0; i < DropPos.Num(); ++i)
	{
		FVector& P = DropPos[i];
		if (i >= Showing)
		{
			Drops->UpdateInstanceTransform(i, FTransform(FRotator::ZeroRotator, FVector(0, 0, -5000000.f), FVector(0.01f)), true, false, true);
			continue;
		}
		P += Fall * Dt;
		for (int32 a = 0; a < 3; ++a)
		{
			if (P[a] < -RainBox) { P[a] += 2.f * RainBox; }
			if (P[a] > RainBox) { P[a] -= 2.f * RainBox; }
		}
		const FVector World = Eye + P;
		const bool bUnder = World.Z < ADragonWorld::HeightAt(World.X, World.Y);
		Drops->UpdateInstanceTransform(i, FTransform(Slant, bUnder ? FVector(0, 0, -5000000.f) : World, FVector(0.025f, 0.025f, 1.3f)), true, false, true);
	}
	Drops->MarkRenderStateDirty();
}

void ADragonSky::UpdateLightning(float Dt)
{
	// In a storm, every so often: two quick flashes lighting the whole land, and the thunder a moment later.
	if (Storm > 0.5f)
	{
		LightningWait -= Dt;
		if (LightningWait <= 0.f)
		{
			LightningWait = FMath::FRandRange(6.f, 16.f);
			FlashTime = 0.f;
			ThunderIn = FMath::FRandRange(0.4f, 2.5f);
			if (Flash)
			{
				Flash->SetActorRotation(FRotator(FMath::FRandRange(-80.f, -40.f), FMath::FRandRange(0.f, 360.f), 0.f));
			}
		}
	}
	float Bright = 0.f;
	if (FlashTime >= 0.f)
	{
		FlashTime += Dt;
		Bright = (FlashTime < 0.07f || (FlashTime > 0.16f && FlashTime < 0.3f)) ? 1.f : FMath::Max(0.f, 1.f - (FlashTime - 0.3f) * 4.f) * 0.3f;
		if (FlashTime > 0.6f)
		{
			FlashTime = -1.f;
		}
	}
	if (Flash)
	{
		Flash->GetLightComponent()->SetIntensity(Bright * 25.f);
	}
	if (ThunderIn >= 0.f)
	{
		ThunderIn -= Dt;
		if (ThunderIn < 0.f && Thunder)
		{
			UGameplayStatics::PlaySound2D(this, Thunder, FMath::FRandRange(0.7f, 1.f), FMath::FRandRange(0.85f, 1.1f));
		}
	}
}
