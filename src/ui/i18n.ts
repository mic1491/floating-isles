const zhTW = {
  'start.title': '浮光群島',
  'start.desktop': '點擊畫面開始',
  'start.touch': '點一下開始',
  'hint.desktop':
    'WASD 移動 · 滑鼠轉鏡頭 · 滾輪縮放 · Shift 衝刺 · 空白鍵跳躍,空中再按滑翔 · 左鍵攻擊 · E 技能 · Q 大招 · 1/2/3 換人',
  'hint.rotate': '請將手機轉為橫向',
  'touch.attack': '攻擊',
  'touch.skill': '技能',
  'touch.burst': '大招',
  'touch.jump': '跳躍',
  'touch.dash': '衝刺',
  'hud.skill': '技能',
  'hud.burst': '大招',
  'hud.hp': '生命',
  'hud.stamina': '體力',
  'hud.quality.high': '畫質:高',
  'hud.quality.low': '畫質:低',
  'character.fire': '燼羽',
  'character.water': '汐音',
  'character.thunder': '鳴川',
  'reaction.vaporize': '蒸發',
  'reaction.overload': '超載',
  'reaction.electroCharged': '感電',
} as const;

export type TextKey = keyof typeof zhTW;

export const t = (key: TextKey): string => zhTW[key];
