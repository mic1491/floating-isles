#!/bin/sh
# Double-click to play Dragon Rider. Set UE if Unreal Engine is somewhere else.
cd "$(dirname "$0")"
UE="${UE:-/Users/Shared/Epic Games/UE_5.8}"
exec "$UE/Engine/Binaries/Mac/UnrealEditor.app/Contents/MacOS/UnrealEditor" "$PWD/DragonRider.uproject" -game -windowed -ResX=1600 -ResY=900
