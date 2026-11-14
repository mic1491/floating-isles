#pragma once

#include "CoreMinimal.h"

class UStaticMesh;
class UMaterialInterface;
class UMaterialInstanceDynamic;

namespace Isle
{
	/** One of the engine's basic shapes: Cube, Sphere, Cylinder, Cone, Plane. */
	UStaticMesh* Mesh(const TCHAR* Shape);
	/** One of the project's materials from Content/Materials, or the engine's plain one before they are built. */
	UMaterialInterface* Mat(const TCHAR* Name);
	/** A copy of a project material with its "Color" parameter set. */
	UMaterialInstanceDynamic* Tinted(const TCHAR* Name, const FLinearColor& Colour, UObject* Outer);
	/** A model from the free Kenney Survival Kit in Content/Packs/Kenney (SM_<Name>), or null when it has not been imported. */
	UStaticMesh* Pack(const TCHAR* Name);
	/** The pack's shared colour-atlas material, multiplied by Colour. */
	UMaterialInstanceDynamic* PackTint(const FLinearColor& Colour, UObject* Outer);
}
