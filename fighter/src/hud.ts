import { CHARS, type CharDef, type Fighter } from './fighter';

const el = (html: string): HTMLElement => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};

export interface MenuChoice {
  char: number;
  level: number;
}

/** Everything drawn over the fight: bars, timer, calls, the menu and the result. */
export class Hud {
  private readonly root = document.getElementById('ui')!;
  private readonly top = el(`<div class="top" style="opacity:0">
    <div class="side p1"><div class="name"></div><div class="bar hp"><i class="lag"></i><i class="fill"></i></div><div class="bar en"><i class="fill"></i></div><div class="pips"></div></div>
    <div class="timer">60</div>
    <div class="side p2"><div class="name"></div><div class="bar hp"><i class="lag"></i><i class="fill"></i></div><div class="bar en"><i class="fill"></i></div><div class="pips"></div></div>
  </div>`);
  private readonly combos = [el('<div class="combo p1"></div>'), el('<div class="combo p2"></div>')];
  private readonly call = el('<div class="announce"></div>');
  private readonly ult = el('<div class="ult"></div>');
  private readonly help = el(`<div class="help" style="display:none">
    <span><kbd>WASD</kbd>移動</span><span><kbd>J</kbd>連打</span><span><kbd>K</kbd>重擊</span><span><kbd>L</kbd>氣彈</span><span><kbd>Shift</kbd>閃身</span><span><kbd>空白</kbd>跳</span><span><kbd>F</kbd>防禦</span><span><kbd>R</kbd>集氣</span><span><kbd>Q</kbd>奧義</span>
  </div>`);
  private readonly menu = el('<div class="panel menu"></div>');
  private readonly result = el('<div class="panel result"></div>');
  private readonly lines = document.getElementById('lines')!;
  private readonly white = document.getElementById('flash')!;
  private callTimer = 0;
  private ultTimer = 0;
  private linesTimer = 0;
  private readonly comboTimers = [0, 0];

  constructor() {
    this.root.append(this.top, ...this.combos, this.call, this.ult, this.help, this.menu, this.result);
  }

  showMenu(choice: MenuChoice, onChange: (c: MenuChoice) => void, onStart: () => void): void {
    const draw = (): void => {
      this.menu.innerHTML = '';
      const title = el('<h1>流光鬥技<small>LUMEN ARENA</small></h1>');
      const pick = el('<div class="pick"></div>');
      const cards = el('<div class="cards"></div>');
      CHARS.forEach((c, i) => {
        const card = el(`<button class="card ${i === choice.char ? 'on' : ''}" style="--c:${c.css}"><b>${c.name}<small>${c.element}</small></b><span>${c.line}</span><em>奧義・${c.ult}</em></button>`);
        card.onclick = () => {
          choice.char = i;
          onChange(choice);
          draw();
        };
        cards.append(card);
      });
      const levels = el('<div class="row"><label>對手強度</label></div>');
      ['簡單', '普通', '困難'].forEach((name, i) => {
        const b = el(`<button class="btn ${i === choice.level ? 'on' : ''}">${name}</button>`);
        b.onclick = () => {
          choice.level = i;
          onChange(choice);
          draw();
        };
        levels.append(b);
      });
      const go = el('<div class="row"><button class="btn go">開始對戰</button></div>');
      (go.firstElementChild as HTMLElement).onclick = onStart;
      pick.append(cards, levels, go);
      this.menu.append(title, pick);
    };
    draw();
    this.menu.classList.add('show');
    this.result.classList.remove('show');
    this.top.style.opacity = '0';
    this.help.style.display = 'none';
  }

  startMatch(p1: CharDef, p2: CharDef): void {
    this.menu.classList.remove('show');
    this.result.classList.remove('show');
    this.top.style.opacity = '1';
    this.help.style.display = '';
    [p1, p2].forEach((c, i) => {
      const side = this.top.querySelector(`.p${i + 1}`) as HTMLElement;
      side.style.setProperty('--c', c.css);
      side.querySelector('.name')!.innerHTML = `${c.name}<small>${c.element}</small>`;
      this.combos[i].style.setProperty('--c', c.css);
    });
  }

  showResult(won: boolean, winner: CharDef, onAgain: () => void, onMenu: () => void): void {
    this.result.innerHTML = '';
    this.result.style.setProperty('--c', winner.css);
    const again = el('<button class="btn go">再戰一場</button>');
    const back = el('<button class="btn">重選角色</button>');
    again.onclick = onAgain;
    back.onclick = onMenu;
    const row = el('<div class="row"></div>');
    row.append(again, back);
    this.result.append(el(`<h2>${won ? 'YOU WIN' : 'YOU LOSE'}</h2>`), el(`<p>${winner.name} 獲勝</p>`), row);
    this.result.classList.add('show');
  }

  bars(fighters: [Fighter, Fighter], wins: [number, number], time: number): void {
    fighters.forEach((f, i) => {
      const side = this.top.querySelector(`.p${i + 1}`) as HTMLElement;
      const hp = side.querySelector('.hp') as HTMLElement;
      const scale = `scaleX(${Math.max(0, f.hp / 100)})`;
      (hp.querySelector('.fill') as HTMLElement).style.transform = scale;
      (hp.querySelector('.lag') as HTMLElement).style.transform = scale;
      hp.classList.toggle('low', f.hp <= 30);
      const en = side.querySelector('.en') as HTMLElement;
      (en.querySelector('.fill') as HTMLElement).style.transform = `scaleX(${f.energy / 100})`;
      en.classList.toggle('max', f.energy >= 100);
      const pips = side.querySelector('.pips') as HTMLElement;
      const html = [0, 1].map((n) => `<b class="${n < wins[i] ? 'won' : ''}"></b>`).join('');
      if (pips.innerHTML !== html) pips.innerHTML = html;
    });
    const text = String(Math.max(0, Math.ceil(time)));
    const timer = this.top.querySelector('.timer')!;
    if (timer.textContent !== text) timer.textContent = text;
  }

  announce(text: string, sub = '', seconds = 1.2): void {
    this.call.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.call.classList.remove('show');
    void this.call.offsetWidth;
    this.call.classList.add('show');
    this.callTimer = seconds;
  }

  ultBanner(c: CharDef): void {
    this.ult.style.setProperty('--c', c.css);
    this.ult.innerHTML = `<small>${c.name}・奧義</small>${c.ult}`;
    this.ult.classList.remove('show');
    void this.ult.offsetWidth;
    this.ult.classList.add('show');
    this.ultTimer = 1.5;
    this.white.animate([{ opacity: 0.7 }, { opacity: 0 }], { duration: 350 });
  }

  combo(side: number, hits: number): void {
    const node = this.combos[side];
    node.innerHTML = `${hits}<small>HITS</small>`;
    node.classList.remove('show');
    void node.offsetWidth;
    node.classList.add('show');
    this.comboTimers[side] = 1.3;
  }

  speedLines(seconds: number): void {
    this.lines.classList.add('on');
    this.linesTimer = Math.max(this.linesTimer, seconds);
  }

  whiteout(strength: number, ms: number): void {
    this.white.animate([{ opacity: strength }, { opacity: 0 }], { duration: ms });
  }

  update(dt: number): void {
    if (this.callTimer > 0 && (this.callTimer -= dt) <= 0) this.call.classList.remove('show');
    if (this.ultTimer > 0 && (this.ultTimer -= dt) <= 0) this.ult.classList.remove('show');
    if (this.linesTimer > 0 && (this.linesTimer -= dt) <= 0) this.lines.classList.remove('on');
    this.comboTimers.forEach((t, i) => {
      if (t > 0 && (this.comboTimers[i] -= dt) <= 0) this.combos[i].classList.remove('show');
    });
  }
}
