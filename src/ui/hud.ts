import { Vector3, type Camera } from 'three';
import { balance } from '../core/balance';
import type { QualityTier } from '../core/quality';
import type { Actions } from '../input/actions';
import type { Party } from '../party/party';
import type { Player } from '../player/player';
import type { Objective } from '../exploration/progress';
import { t } from './i18n';

const div = (className: string, parent: HTMLElement, text = ''): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
};

const projected = new Vector3();

export class Hud {
  private readonly hpFill: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly staminaBar: HTMLElement;
  private readonly slots: HTMLElement[] = [];
  private readonly skillLabel: HTMLElement;
  private readonly burstLabel: HTMLElement;
  private readonly floats: HTMLElement;
  private readonly hurtFlash: HTMLElement;
  private readonly quality: HTMLButtonElement;
  private readonly pixel: HTMLButtonElement;
  private readonly settings: HTMLElement;
  private readonly explore: HTMLElement;
  private readonly goal: HTMLElement;
  private readonly goalArrow: HTMLElement;
  private readonly goalText: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly fadeLayer: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly camera: Camera,
    actions: Actions,
    party: Party,
    tier: QualityTier,
    onQuality: () => void,
    pixelArt: boolean,
    onPixel: () => void,
  ) {
    this.floats = div('floats', root);
    this.hurtFlash = div('hurt-flash', root);
    this.fadeLayer = div('fade', root);

    const bars = div('bars', root);
    const hp = div('bar hp', bars);
    this.hpFill = div('fill', hp);
    div('bar-label', hp, t('hud.hp'));
    this.staminaBar = div('bar stamina', bars);
    this.staminaFill = div('fill', this.staminaBar);
    div('bar-label', this.staminaBar, t('hud.stamina'));

    this.explore = div('explore', root);
    this.goal = div('goal', root);
    this.goalArrow = div('goal-arrow', this.goal, '▲');
    this.goalText = div('goal-text', this.goal);
    this.prompt = div('prompt', root, t('explore.prompt'));
    this.toasts = div('toasts', root);

    const partyBar = div('party', root);
    party.members.forEach((member, i) => {
      const slot = div('slot', partyBar, `${i + 1} ${t(`character.${member.element}`)}`);
      slot.style.setProperty('--accent', member.color);
      slot.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        actions.switchTo = i;
      });
      this.slots.push(slot);
    });

    const abilities = div('abilities', root);
    this.skillLabel = div('ability', abilities);
    this.burstLabel = div('ability', abilities);

    const settings = div('settings', root);
    this.quality = document.createElement('button');
    this.quality.addEventListener('click', onQuality);
    this.pixel = document.createElement('button');
    this.pixel.addEventListener('click', onPixel);
    this.settings = settings;
    settings.append(this.pixel, this.quality);
    this.setQuality(tier);
    this.setPixel(pixelArt);
  }

  /** Adds a button to the top-right cluster, left of the existing ones. */
  addButton(label: string, onClick: () => void): void {
    const node = document.createElement('button');
    node.textContent = label;
    node.addEventListener('click', onClick);
    this.settings.prepend(node);
  }

  setQuality(tier: QualityTier): void {
    this.quality.textContent = t(tier === 'high' ? 'hud.quality.high' : 'hud.quality.low');
  }

  setPixel(on: boolean): void {
    this.pixel.textContent = t(on ? 'hud.pixel.on' : 'hud.pixel.off');
  }

  update(player: Player, party: Party): void {
    this.hpFill.style.width = `${(player.hp / player.maxHp) * 100}%`;
    this.staminaFill.style.width = `${player.stamina.ratio * 100}%`;
    this.staminaBar.classList.toggle('low', player.stamina.ratio < 0.2);
    this.slots.forEach((slot, i) => slot.classList.toggle('active', i === party.activeIndex));

    const i = party.activeIndex;
    const cooldown = party.skillCooldowns[i];
    this.skillLabel.textContent = `${t('hud.skill')} ${cooldown > 0 ? cooldown.toFixed(1) : 'OK'}`;
    this.skillLabel.classList.toggle('ready', cooldown === 0);
    const energy = party.energy[i] / balance.combat.energyMax;
    this.burstLabel.textContent = `${t('hud.burst')} ${Math.round(energy * 100)}%`;
    this.burstLabel.classList.toggle('ready', energy >= 1);
  }

  floatText(at: Vector3, text: string, color: string, large = false): void {
    projected.copy(at).setY(at.y + 1.6).project(this.camera);
    if (projected.z > 1) return;
    const node = div(large ? 'float large' : 'float', this.floats, text);
    node.style.left = `${(projected.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 34}px`;
    node.style.top = `${(-projected.y * 0.5 + 0.5) * innerHeight}px`;
    node.style.color = color;
    node.addEventListener('animationend', () => node.remove());
  }

  setExploration(found: number, total: number, coins: number, shards: number): void {
    this.explore.textContent =
      `${t('explore.progress')} ${found}/${total} · ${t('explore.coins')} ${coins} · ${t('explore.shards')} ${shards}`;
  }

  /** The quest line: what to look for next, how far, and an arrow toward it. */
  setObjective(objective: Objective | null): void {
    this.goal.classList.toggle('done', objective === null);
    if (!objective) {
      this.goalText.textContent = t('goal.done');
      return;
    }
    this.goalArrow.style.transform = `rotate(${objective.bearing}rad)`;
    this.goalText.textContent =
      `${t('goal.prefix')}${t(`goal.${objective.point.kind}`)} · ${Math.round(objective.distance)} m`;
  }

  setPrompt(visible: boolean): void {
    this.prompt.classList.toggle('on', visible);
    this.prompt.parentElement!.classList.toggle('can-interact', visible);
  }

  toast(text: string): void {
    const node = div('toast', this.toasts, text);
    node.addEventListener('animationend', () => node.remove());
  }

  fade(): void {
    this.fadeLayer.classList.remove('on');
    void this.fadeLayer.offsetWidth;
    this.fadeLayer.classList.add('on');
  }

  flashHurt(): void {
    this.hurtFlash.classList.remove('on');
    void this.hurtFlash.offsetWidth;
    this.hurtFlash.classList.add('on');
  }
}
