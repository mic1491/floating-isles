#include "SITypes.h"

namespace
{
	FCost Make(int32 Wood, int32 Stone, int32 Fiber, int32 Berry, int32 Crystal)
	{
		FCost C;
		C.Amount[0] = Wood;
		C.Amount[1] = Stone;
		C.Amount[2] = Fiber;
		C.Amount[3] = Berry;
		C.Amount[4] = Crystal;
		return C;
	}
}

namespace Isle
{
	const TCHAR* ItemName(EItem Item)
	{
		static const TCHAR* Names[NumItems] = { TEXT("木材"), TEXT("石頭"), TEXT("纖維"), TEXT("莓果"), TEXT("風暴水晶") };
		return Names[int32(Item)];
	}

	const TCHAR* PieceName(EPiece Piece)
	{
		static const TCHAR* Names[NumPieces] = { TEXT("地板"), TEXT("牆"), TEXT("屋頂"), TEXT("營火"), TEXT("風暴信標") };
		return Names[int32(Piece)];
	}

	const TCHAR* CraftName(ECraft Craft)
	{
		static const TCHAR* Names[NumCrafts] = { TEXT("石斧"), TEXT("石鎬"), TEXT("石矛"), TEXT("草藥繃帶") };
		return Names[int32(Craft)];
	}

	const TCHAR* CraftNote(ECraft Craft)
	{
		static const TCHAR* Notes[NumCrafts] = {
			TEXT("砍樹得到雙倍木材"), TEXT("敲石得到雙倍石頭"), TEXT("攻擊力大幅提升"), TEXT("按 H 使用，回復 40 生命") };
		return Notes[int32(Craft)];
	}

	const FCost& PieceCost(EPiece Piece)
	{
		static const FCost Costs[NumPieces] = {
			Make(4, 0, 0, 0, 0),   // floor
			Make(4, 0, 0, 0, 0),   // wall
			Make(3, 0, 2, 0, 0),   // roof
			Make(5, 3, 0, 0, 0),   // campfire
			Make(6, 8, 0, 0, 5),   // beacon
		};
		return Costs[int32(Piece)];
	}

	const FCost& CraftCost(ECraft Craft)
	{
		static const FCost Costs[NumCrafts] = {
			Make(3, 2, 2, 0, 0),   // axe
			Make(3, 3, 2, 0, 0),   // pick
			Make(4, 2, 3, 0, 0),   // spear
			Make(0, 0, 3, 2, 0),   // bandage
		};
		return Costs[int32(Craft)];
	}

	FString CostText(const FCost& Cost)
	{
		FString S;
		for (int32 i = 0; i < NumItems; ++i)
		{
			if (Cost.Amount[i] > 0)
			{
				if (!S.IsEmpty())
				{
					S += TEXT("　");
				}
				S += FString::Printf(TEXT("%s %d"), ItemName(EItem(i)), Cost.Amount[i]);
			}
		}
		return S;
	}
}
