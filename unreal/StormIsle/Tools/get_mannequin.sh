#!/bin/sh
# Copies Epic's mannequin character pack (meshes, materials, animations) from the engine's
# templates into Content/Characters. It ships with the engine, so it is not kept in the repository.
# Usage: Tools/get_mannequin.sh   (set UE to the engine folder if it is not the default)
set -e
cd "$(dirname "$0")/.."
UE="${UE:-/Users/Shared/Epic Games/UE_5.8}"
mkdir -p Content/Characters
cp -R "$UE/Templates/TemplateResources/High/Characters/Content/Mannequins" Content/Characters/
echo "Mannequin copied to Content/Characters/Mannequins"
