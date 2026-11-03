import type { ExplorationProgress } from '../exploration/progress';
import { damageScale, MAX_LEVEL } from '../party/growth';
import type { Party } from '../party/party';
import { t } from './i18n';

export interface GrowthEvents {
  opened(): void;
  closed(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
};

interface Card {
  level: HTMLElement;
  fill: HTMLElement;
  xp: HTMLElement;
  power: HTMLElement;
}

/** The party screen: each character's level, experience and strength. */
export class GrowthView {
  open = false;
  private readonly overlay: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly cards: Card[] = [];

  constructor(
    root: HTMLElement,
    private readonly party: Party,
    private readonly progress: ExplorationProgress,
    private readonly events: GrowthEvents,
  ) {
    this.overlay = el('div', 'growth-overlay', root);
    el('h2', 'growth-title', this.overlay, t('growth.title'));
    this.wallet = el('div', 'growth-wallet', this.overlay);
    const row = el('div', 'growth-cards', this.overlay);
    party.members.forEach((member) => {
      const card = el('div', 'growth-card', row);
      card.style.setProperty('--accent', member.color);
      el('div', 'growth-name', card, t(`character.${member.element}`));
      const level = el('div', 'growth-level', card);
      const bar = el('div', 'growth-xpbar', card);
      const fill = el('div', 'growth-xpfill', bar);
      const xp = el('div', 'growth-stat', card);
      const power = el('div', 'growth-stat', card);
      this.cards.push({ level, fill, xp, power });
    });
    el('p', 'growth-note', this.overlay, t('growth.note'));
    el('button', 'growth-close', this.overlay, t('map.close')).addEventListener('click', () => this.hide());
    addEventListener('keydown', (event) => {
      if (this.open && event.code === 'Escape') this.hide();
    });
  }

  toggle(): void {
    if (this.open) this.hide();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.overlay.classList.add('on');
    this.events.opened();
    this.refresh();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.overlay.classList.remove('on');
    this.events.closed();
  }

  private refresh(): void {
    this.wallet.textContent = `${t('explore.coins')} ${this.progress.coins} · ${t('explore.shards')} ${this.progress.shards}`;
    this.cards.forEach((card, i) => {
      const info = this.party.info(i);
      card.level.textContent = `Lv ${info.level}${info.level >= MAX_LEVEL ? ' (MAX)' : ''}`;
      card.fill.style.width = `${info.ratio * 100}%`;
      card.xp.textContent = info.need === 0 ? t('growth.maxed') : `${t('growth.xp')} ${info.into} / ${info.need}`;
      card.power.textContent = `${t('growth.damage')} ×${damageScale(info.level).toFixed(2)}`;
    });
  }
}
