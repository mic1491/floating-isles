# Dragon Rider（Unreal Engine 5）

騎著龍在群島上空飛行，依序穿過 24 個光環並計時。

整個世界（天空、太陽、雲、海、地形、光環）都由 C++ 在遊戲開始時生成，不需要在編輯器裡做關卡。

## 狀態

**程式碼尚未編譯過**：寫這份專案的機器沒有安裝 Unreal Engine，第一次編譯可能需要修正。

## 第一次執行

1. 用 Epic Games Launcher 安裝 Unreal Engine 5（5.4 以上），Mac 需要 Xcode。
2. 對 `DragonRider.uproject` 按兩下，讓它編譯並開啟編輯器。
3. 匯入龍的模型並建立材質（只需一次）：編輯器選單 Tools > Execute Python Script，選 `Tools/setup_assets.py`。
   沒做這步也能玩，只是龍會是一個圓錐，材質是灰色。
4. 按 Play。

## 操作

| 動作 | 鍵盤滑鼠 | 手把 |
| --- | --- | --- |
| 抬頭 / 低頭 | S / W，或滑鼠上下 | 左搖桿 |
| 轉向 | A / D，或滑鼠左右 | 左搖桿 |
| 拍翅加速 | 空白鍵或滑鼠左鍵 | A |
| 減速 | 左 Shift | LT |
| 重新開始 | R | Start |

俯衝會加速，爬升會減速，太慢時龍頭會自己往下掉。

## 檔案

- `Source/DragonRider/DragonPawn.*`：飛行、鏡頭，以及用程式擺動翅膀、脖子、尾巴
- `Source/DragonRider/DragonWorld.*`：天空、海、地形、光環賽道
- `Source/DragonRider/DragonHUD.*`：速度、高度、光環數、時間
- `Tools/build_dragon.py`：用 Blender 產生 `SourceArt/dragon.fbx`
- `Tools/setup_assets.py`：在編輯器裡匯入模型、建立材質
