#!/bin/sh
# Rebuilds the project's own assets (textures, materials) in Content/ from SourceArt/. Close the editor first.
# Usage: Tools/rebuild_assets.sh   (set UE to the engine folder if it is not the default)
set -e
cd "$(dirname "$0")/.."
UE="${UE:-/Users/Shared/Epic Games/UE_5.8}"
[ -d Content/Characters/Mannequins ] || Tools/get_mannequin.sh
rm -rf Content/Materials Content/Textures
"$UE/Engine/Binaries/Mac/UnrealEditor-Cmd" "$PWD/StormIsle.uproject" -run=pythonscript \
	-script="$PWD/Tools/setup_assets.py" -unattended -nosplash
