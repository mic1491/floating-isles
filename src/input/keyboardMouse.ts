import { balance } from '../core/balance';
import type { Actions } from './actions';

export const bindKeyboardMouse = (canvas: HTMLCanvasElement, actions: Actions): void => {
  const keys = new Set<string>();
  const sync = () => {
    actions.moveX = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
    actions.moveY = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
    actions.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
  };

  addEventListener('keydown', (event) => {
    if (event.repeat) return;
    keys.add(event.code);
    if (event.code === 'Space') actions.jumpPressed = true;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') actions.dashPressed = true;
    if (event.code === 'KeyE') actions.skillPressed = true;
    if (event.code === 'KeyQ') actions.burstPressed = true;
    if (event.code === 'KeyF') actions.interactPressed = true;
    if (event.code === 'KeyM') actions.mapPressed = true;
    if (event.code.startsWith('Digit')) {
      const slot = Number(event.code.slice(5)) - 1;
      if (slot >= 0 && slot < balance.characters.length) actions.switchTo = slot;
    }
    if (event.code === 'Space') event.preventDefault();
    sync();
  });
  addEventListener('keyup', (event) => {
    keys.delete(event.code);
    sync();
  });
  addEventListener('blur', () => {
    keys.clear();
    actions.attack = false;
    sync();
  });

  canvas.addEventListener('mousedown', (event) => {
    if (document.pointerLockElement !== canvas) {
      void canvas.requestPointerLock();
      return;
    }
    if (event.button === 0) actions.attack = true;
  });
  addEventListener('mouseup', () => {
    actions.attack = false;
  });
  addEventListener('mousemove', (event) => {
    if (document.pointerLockElement !== canvas) return;
    actions.lookX += event.movementX * balance.camera.sensitivity;
    actions.lookY += event.movementY * balance.camera.sensitivity;
  });
  addEventListener('wheel', (event) => {
    actions.zoom += Math.sign(event.deltaY);
  });
};
