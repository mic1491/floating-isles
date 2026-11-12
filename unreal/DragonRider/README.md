# Dragon Rider（Unreal Engine 5）

騎著龍在群島上空飛行，依序穿過 24 個光環並計時。

整個世界（天空、太陽、雲、海、地形、光環）都由 C++ 在遊戲開始時生成，不需要在編輯器裡做關卡。

![遊戲畫面](SourceArt/screenshot.jpg)

## 狀態

已在 Unreal Engine 5.8.4（Mac，Apple M4）編譯並實際執行過。

## 執行

需要 Unreal Engine 5.8、Xcode，以及 Xcode 的 Metal Toolchain（`xcodebuild -downloadComponent MetalToolchain`）。

- 對 `DragonRider.uproject` 按兩下開啟編輯器，按 Play。
- 模型、貼圖、材質都已放在 `Content/`。改了 `SourceArt/` 之後，關掉編輯器並執行 `Tools/rebuild_assets.sh` 重建。

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
- `Tools/build_textures.py`：用 Blender 產生 `SourceArt/tex/` 的貼圖
- `Tools/rebuild_assets.sh`、`Tools/setup_assets.py`：匯入模型與貼圖、建立材質
