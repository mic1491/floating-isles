import { Vector3, type Camera } from 'three';
import { balance } from '../core/balance';
import type { QualityTier } from '../core/quality';
import type { Actions } from '../input/actions';
import type { Party } from '../party/party';
import type { Player } from '../player/player';
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

  constructor(
    root: HTMLElement,
    private readonly camera: Camera,
    actions: Actions,
    party: Party,
    tier: QualityTier,
    onQuality: () => void,
  ) {
    this.floats = div('floats', root);
    this.hurtFlash = div('hurt-flash', root);

    const bars = div('bars', root);
    const hp = div('bar hp', bars);
    this.hpFill = div('fill', hp);
    div('bar-label', hp, t('hud.hp'));
    this.staminaBar = div('bar stamina', bars);
    this.staminaFill = div('fill', this.staminaBar);
    div('bar-label', this.staminaBar, t('hud.stamina'));

    const partyBar = div('party', root);
    party.members.forEach((member, i) => {
      const slot = div('slot', partyBar, `${i + 1} ${t(`element.${member.element}`)}`);
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

    this.quality = document.createElement('button');
    this.quality.className = 'quality';
    this.quality.addEventListener('click', onQuality);
    root.append(this.quality);
    this.setQuality(tier);
  }

  setQuality(tier: QualityTier): void {
    this.quality.textContent = t(tier === 'high' ? 'hud.quality.high' : 'hud.quality.low');
  }

  update(player: Player, party: Party): void {
    this.hpFill.style.width = `${(player.hp / balance.player.maxHp) * 100}%`;
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

  flashHurt(): void {
    this.hurtFlash.classList.remove('on');
    void this.hurtFlash.offsetWidth;
    this.hurtFlash.classList.add('on');
  }
}
