import type { ExplorationProgress } from '../exploration/progress';
import { canUpgrade, damageScale, MAX_LEVEL, upgradeCost } from '../party/growth';
import type { Party } from '../party/party';
import { t } from './i18n';

export interface GrowthEvents {
  opened(): void;
  closed(): void;
  upgraded(): void;
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
  power: HTMLElement;
  cost: HTMLElement;
  upgrade: HTMLButtonElement;
}

/** The party screen: spend coins and shards to raise each character. */
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
    party.members.forEach((member, i) => {
      const card = el('div', 'growth-card', row);
      card.style.setProperty('--accent', member.color);
      el('div', 'growth-name', card, t(`character.${member.element}`));
      const level = el('div', 'growth-level', card);
      const power = el('div', 'growth-stat', card);
      const cost = el('div', 'growth-cost', card);
      const upgrade = el('button', 'growth-upgrade', card, t('growth.upgrade'));
      upgrade.addEventListener('click', () => this.upgrade(i));
      this.cards.push({ level, power, cost, upgrade });
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

  private upgrade(index: number): void {
    const level = this.party.levels[index];
    if (!canUpgrade(level, this.progress.coins, this.progress.shards)) return;
    const cost = upgradeCost(level);
    if (!this.progress.spend(cost.coins, cost.shards)) return;
    this.party.levels[index] = level + 1;
    this.events.upgraded();
    this.refresh();
  }

  private refresh(): void {
    this.wallet.textContent = `${t('explore.coins')} ${this.progress.coins} · ${t('explore.shards')} ${this.progress.shards}`;
    this.cards.forEach((card, i) => {
      const level = this.party.levels[i];
      const maxed = level >= MAX_LEVEL;
      const cost = upgradeCost(level);
      card.level.textContent = `Lv ${level}${maxed ? ' (MAX)' : ''}`;
      card.power.textContent = `${t('growth.damage')} ×${damageScale(level).toFixed(2)}`;
      card.cost.textContent = maxed ? t('growth.maxed') : `${cost.coins} ${t('explore.coins')} + ${cost.shards} ${t('explore.shards')}`;
      card.upgrade.disabled = !canUpgrade(level, this.progress.coins, this.progress.shards);
    });
  }
}
