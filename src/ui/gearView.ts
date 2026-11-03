import type { ExplorationProgress } from '../exploration/progress';
import { GEAR_ITEMS, itemById, MAX_GEAR_LEVEL, statValue, upgradeCost, type GearItem, type GearStat } from '../party/gear';
import type { Party } from '../party/party';
import { t, type TextKey } from './i18n';

export interface GearEvents {
  opened(): void;
  closed(): void;
  /** Something was bought, upgraded or swapped, so numbers elsewhere need refreshing and the game saved. */
  changed(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent: HTMLElement, text = ''): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
};

const percent = (value: number): string => `${Math.round(value * 100)}%`;

const describe = (stat: GearStat, value: number): string => {
  const label = t(`gear.stat.${stat}` as TextKey);
  return stat === 'hp' ? `${label} +${Math.round(value)}` : `${label} +${percent(value)}`;
};

/** The equipment screen: pick a character, then buy, upgrade and wear weapons and accessories. */
export class GearView {
  open = false;
  private character = 0;
  private readonly overlay: HTMLElement;
  private readonly wallet: HTMLElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly party: Party,
    private readonly progress: ExplorationProgress,
    private readonly events: GearEvents,
  ) {
    this.overlay = el('div', 'gear-overlay', root);
    el('h2', 'growth-title', this.overlay, t('gear.title'));
    this.wallet = el('div', 'growth-wallet', this.overlay);
    const tabs = el('div', 'gear-tabs', this.overlay);
    party.members.forEach((member, i) => {
      const tab = el('button', 'gear-tab', tabs, t(`character.${member.element}`));
      tab.style.setProperty('--accent', member.color);
      tab.addEventListener('click', () => {
        this.character = i;
        this.refresh();
      });
      this.tabs.push(tab);
    });
    this.summary = el('div', 'gear-summary', this.overlay);
    this.list = el('div', 'gear-list', this.overlay);
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
    this.character = this.party.activeIndex;
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

  private act(change: () => boolean): void {
    if (!change()) return;
    this.events.changed();
    this.refresh();
  }

  private refresh(): void {
    const gear = this.party.gear;
    const element = this.party.members[this.character].element;
    this.wallet.textContent = `${t('explore.coins')} ${this.progress.coins} · ${t('explore.shards')} ${this.progress.shards}`;
    this.tabs.forEach((tab, i) => tab.classList.toggle('on', i === this.character));

    const loadout = gear.loadouts[this.character];
    const worn = [loadout.weapon, ...loadout.accessories].map((id) => (id ? itemById(id)!.name : t('gear.empty')));
    this.summary.textContent = `${t('gear.weapon')}:${worn[0]} · ${t('gear.accessory')}:${worn[1]} / ${worn[2]}`;

    this.list.replaceChildren();
    const section = (title: string, items: GearItem[]) => {
      el('div', 'gear-section', this.list, title);
      for (const item of items) this.row(item);
    };
    section(t('gear.weapon'), GEAR_ITEMS.filter((i) => i.slot === 'weapon' && i.for === element));
    section(t('gear.accessory'), GEAR_ITEMS.filter((i) => i.slot === 'accessory'));
  }

  private row(item: GearItem): void {
    const gear = this.party.gear;
    const level = gear.level(item.id);
    const row = el('div', 'gear-row', this.list);
    const worn = item.slot === 'weapon' ? gear.loadouts[this.character].weapon === item.id : gear.loadouts[this.character].accessories.includes(item.id);
    row.classList.toggle('worn', worn);
    const name = el('div', 'gear-name', row, item.name);
    el('small', '', name, level > 0 ? ` Lv ${level}` : '');
    el('div', 'gear-stat', row, describe(item.stat, statValue(item, Math.max(1, level))));
    const actions = el('div', 'gear-actions', row);
    const button = (label: string, run: () => boolean, enabled = true) => {
      const node = el('button', '', actions, label);
      node.disabled = !enabled;
      node.addEventListener('click', () => this.act(run));
    };

    if (level === 0) {
      const afford = this.progress.coins >= item.buy.coins && this.progress.shards >= item.buy.shards;
      button(`${t('gear.buy')} ${item.buy.coins}+${item.buy.shards}`, () => gear.buy(item.id, this.progress), afford);
      return;
    }
    if (level < MAX_GEAR_LEVEL) {
      const cost = upgradeCost(item, level);
      const afford = this.progress.coins >= cost.coins && this.progress.shards >= cost.shards;
      button(`${t('gear.upgrade')} ${cost.coins}+${cost.shards}`, () => gear.upgrade(item.id, this.progress), afford);
    } else {
      el('span', 'gear-max', actions, t('gear.max'));
    }
    if (item.slot === 'weapon') {
      if (!worn) button(t('gear.equip'), () => gear.equip(this.character, item.id));
    } else if (worn) {
      const slot = gear.loadouts[this.character].accessories.indexOf(item.id);
      button(t('gear.unequip'), () => {
        gear.unequip(this.character, slot);
        return true;
      });
    } else {
      const open = gear.loadouts[this.character].accessories.indexOf(null);
      button(t('gear.equip'), () => gear.equip(this.character, item.id, open >= 0 ? open : 0));
    }
  }
}
