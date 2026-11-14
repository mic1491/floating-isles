#include "SIUtil.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "Materials/MaterialInstanceDynamic.h"

namespace Isle
{
	UStaticMesh* Mesh(const TCHAR* Shape)
	{
		return LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("/Engine/BasicShapes/%s.%s"), Shape, Shape));
	}

	UMaterialInterface* Mat(const TCHAR* Name)
	{
		UMaterialInterface* M = LoadObject<UMaterialInterface>(nullptr, *FString::Printf(TEXT("/Game/Materials/%s.%s"), Name, Name), nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!M)
		{
			// Before Tools/setup_assets.py has been run the project materials do not exist yet.
			M = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial"));
		}
		return M;
	}

	UMaterialInstanceDynamic* Tinted(const TCHAR* Name, const FLinearColor& Colour, UObject* Outer)
	{
		UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(Mat(Name), Outer);
		M->SetVectorParameterValue(TEXT("Color"), Colour);
		return M;
	}

	UStaticMesh* Pack(const TCHAR* Name)
	{
		return LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("/Game/Packs/Kenney/SM_%s.SM_%s"), Name, Name), nullptr, LOAD_NoWarn | LOAD_Quiet);
	}

	UMaterialInstanceDynamic* PackTint(const FLinearColor& Colour, UObject* Outer)
	{
		UMaterialInterface* Base = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Packs/Kenney/M_KenneyAtlas.M_KenneyAtlas"), nullptr, LOAD_NoWarn | LOAD_Quiet);
		UMaterialInstanceDynamic* M = UMaterialInstanceDynamic::Create(Base ? Base : Mat(TEXT("M_Prop")), Outer);
		M->SetVectorParameterValue(TEXT("Color"), Colour);
		return M;
	}
}
