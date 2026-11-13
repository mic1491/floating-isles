#pragma once

#include "CoreMinimal.h"

/** Things the player can carry. */
enum class EItem : uint8 { Wood, Stone, Fiber, Berry, Crystal, Count };
constexpr int32 NumItems = int32(EItem::Count);

/** Pieces the player can build. */
enum class EPiece : uint8 { Floor, Wall, Roof, Campfire, Beacon, Count };
constexpr int32 NumPieces = int32(EPiece::Count);

/** Hand-made things kept in the pack. Tools work while carried; a bandage is used up. */
enum class ECraft : uint8 { Axe, Pick, Spear, Bandage, Count };
constexpr int32 NumCrafts = int32(ECraft::Count);

struct FCost
{
	int32 Amount[NumItems] = {};
};

namespace Isle
{
	const TCHAR* ItemName(EItem Item);
	const TCHAR* PieceName(EPiece Piece);
	const TCHAR* CraftName(ECraft Craft);
	const TCHAR* CraftNote(ECraft Craft);
	const FCost& PieceCost(EPiece Piece);
	const FCost& CraftCost(ECraft Craft);
	/** "木材 4　石頭 2" */
	FString CostText(const FCost& Cost);

	/** Size of one building cell, in cm. */
	constexpr float Cell = 400.f;
	constexpr float WallHeight = 300.f;
}
