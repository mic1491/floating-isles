import { balance } from '../core/balance';
import { t } from '../ui/i18n';
import type { Actions } from './actions';

const JOYSTICK_RADIUS = 56;

const element = (tag: string, className: string, parent: HTMLElement, text = ''): HTMLElement => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  parent.append(node);
  return node;
};

export const bindTouch = (root: HTMLElement, actions: Actions): void => {
  const layer = element('div', 'touch-layer', root);
  const moveZone = element('div', 'touch-move', layer);
  const lookZone = element('div', 'touch-look', layer);
  const base = element('div', 'joystick-base', layer);
  const knob = element('div', 'joystick-knob', base);

  let movePointer: number | null = null;
  let originX = 0;
  let originY = 0;

  moveZone.addEventListener('pointerdown', (event) => {
    if (movePointer !== null) return;
    movePointer = event.pointerId;
    originX = event.clientX;
    originY = event.clientY;
    moveZone.setPointerCapture(event.pointerId);
    base.style.transform = `translate(${originX - JOYSTICK_RADIUS}px, ${originY - JOYSTICK_RADIUS}px)`;
    base.classList.add('active');
  });
  moveZone.addEventListener('pointermove', (event) => {
    if (event.pointerId !== movePointer) return;
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    const scale = Math.min(1, JOYSTICK_RADIUS / (Math.hypot(dx, dy) || 1));
    actions.moveX = (dx * scale) / JOYSTICK_RADIUS;
    actions.moveY = (-dy * scale) / JOYSTICK_RADIUS;
    knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
  });
  const endMove = (event: PointerEvent) => {
    if (event.pointerId !== movePointer) return;
    movePointer = null;
    actions.moveX = 0;
    actions.moveY = 0;
    knob.style.transform = '';
    base.classList.remove('active');
  };
  moveZone.addEventListener('pointerup', endMove);
  moveZone.addEventListener('pointercancel', endMove);

  const looks = new Map<number, { x: number; y: number }>();
  let pinch = 0;
  const pinchDistance = () => {
    const [a, b] = [...looks.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  lookZone.addEventListener('pointerdown', (event) => {
    lookZone.setPointerCapture(event.pointerId);
    looks.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (looks.size === 2) pinch = pinchDistance();
  });
  lookZone.addEventListener('pointermove', (event) => {
    const last = looks.get(event.pointerId);
    if (!last) return;
    if (looks.size === 1) {
      actions.lookX += (event.clientX - last.x) * balance.camera.touchSensitivity;
      actions.lookY += (event.clientY - last.y) * balance.camera.touchSensitivity;
    }
    last.x = event.clientX;
    last.y = event.clientY;
    if (looks.size === 2) {
      const distance = pinchDistance();
      actions.zoom += (pinch - distance) * 0.03;
      pinch = distance;
    }
  });
  const endLook = (event: PointerEvent) => looks.delete(event.pointerId);
  lookZone.addEventListener('pointerup', endLook);
  lookZone.addEventListener('pointercancel', endLook);

  const buttons = element('div', 'touch-buttons', layer);
  const button = (label: string, className: string, down: () => void, up?: () => void) => {
    const node = element('button', `touch-button ${className}`, buttons, label);
    node.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      node.setPointerCapture(event.pointerId);
      down();
    });
    if (up) {
      node.addEventListener('pointerup', up);
      node.addEventListener('pointercancel', up);
    }
  };
  button(t('touch.attack'), 'attack', () => {
    actions.attack = true;
    actions.attackPressed = true;
  }, () => (actions.attack = false));
  button(t('touch.skill'), 'skill', () => (actions.skillPressed = true));
  button(t('touch.burst'), 'burst', () => (actions.burstPressed = true));
  button(t('touch.jump'), 'jump', () => (actions.jumpPressed = true));
  button(t('touch.interact'), 'interact', () => (actions.interactPressed = true));
  button(
    t('touch.dash'),
    'dash',
    () => {
      actions.dashPressed = true;
      actions.sprint = true;
    },
    () => (actions.sprint = false),
  );
};
