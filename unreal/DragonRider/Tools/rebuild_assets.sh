#!/bin/sh
# Rebuilds the project's own assets in Content/ from SourceArt/ (not Content/SakuraDragon). Close the editor first.
# Usage: Tools/rebuild_assets.sh   (set UE to the engine folder if it is not the default)
set -e
cd "$(dirname "$0")/.."
UE="${UE:-/Users/Shared/Epic Games/UE_5.8}"
rm -rf Content/Dragon Content/Rider Content/Materials
"$UE/Engine/Binaries/Mac/UnrealEditor-Cmd" "$PWD/DragonRider.uproject" -run=pythonscript \
	-script="$PWD/Tools/setup_assets.py" -unattended -nosplash
