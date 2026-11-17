#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DragonSky.generated.h"

class ADirectionalLight;
class AExponentialHeightFog;
class ASkyLight;
class AVolumetricCloud;
class UAudioComponent;
class UInstancedStaticMeshComponent;
class UMaterialInstanceDynamic;
class USoundBase;

/**
 * Time of day and weather.
 *
 * A day lasts DayMinutes of play: the sun rises and sets, and at night a moon lights the islands.
 * The weather wanders between clear, cloudy, rain and storm every few minutes, changing the cloud
 * cover, fog, light and sound; rain falls round the camera, storms bring lightning and thunder,
 * and wet weather makes fire spread less readily. H moves the clock on three hours, Y brings the
 * next weather.
 */
UCLASS()
class ADragonSky : public AActor
{
	GENERATED_BODY()

public:
	ADragonSky();
	virtual void Tick(float DeltaSeconds) override;

	enum class EWeather : uint8 { Clear, Cloudy, Rain, Storm };

	float GetHour() const { return Hour; }
	EWeather GetWeather() const { return Weather; }
	const TCHAR* GetWeatherName() const;
	/** How hard it is raining now, 0 to 1. Fire reads this to spread less in the wet. */
	static float RainNow;

	UPROPERTY(EditAnywhere, Category = "Sky")
	float DayMinutes = 16.f;

private:
	void Start();
	void SetWeather(EWeather New);
	void UpdateLight(float Dt);
	void UpdateRain(float Dt, const FVector& Eye);
	void UpdateLightning(float Dt);

	UPROPERTY()
	TObjectPtr<ADirectionalLight> Sun;
	UPROPERTY()
	TObjectPtr<ADirectionalLight> Moon;
	UPROPERTY()
	TObjectPtr<ADirectionalLight> Flash;
	UPROPERTY()
	TObjectPtr<ASkyLight> SkyLight;
	UPROPERTY()
	TObjectPtr<AExponentialHeightFog> Fog;
	UPROPERTY()
	TObjectPtr<UMaterialInstanceDynamic> Clouds;
	UPROPERTY()
	TObjectPtr<UInstancedStaticMeshComponent> Drops;
	UPROPERTY()
	TObjectPtr<UAudioComponent> RainAudio;
	UPROPERTY()
	TObjectPtr<USoundBase> Thunder;

	bool bStarted = false;
	float Hour = 9.f;
	EWeather Weather = EWeather::Clear;
	float WeatherLeft = 0.f;
	// Where each effect is now, easing towards what the weather calls for.
	float Overcast = 0.f, Rain = 0.f, Storm = 0.f;
	float CloudCoverage0 = 0.f, CloudDensity0 = 0.f;
	float FogDensity0 = 0.f;

	TArray<FVector> DropPos;
	float LightningWait = 8.f;
	float FlashTime = -1.f;
	float ThunderIn = -1.f;
};
