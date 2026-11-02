/** The single input surface: keyboard, mouse and touch all write here. */
export class Actions {
  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;
  zoom = 0;
  sprint = false;
  attack = false;
  jumpPressed = false;
  dashPressed = false;
  skillPressed = false;
  burstPressed = false;
  interactPressed = false;
  mapPressed = false;
  switchTo: number | null = null;

  /** Clears everything that lasts a single frame. */
  endFrame(): void {
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
    this.jumpPressed = false;
    this.dashPressed = false;
    this.skillPressed = false;
    this.burstPressed = false;
    this.interactPressed = false;
    this.mapPressed = false;
    this.switchTo = null;
  }
}
