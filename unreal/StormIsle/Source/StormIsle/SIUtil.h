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
}
