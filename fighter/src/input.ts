/** Keys and mouse buttons: which are held, and which went down since the game last looked. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor(onFirst: () => void) {
    addEventListener('keydown', (e) => {
      onFirst();
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('mousedown', (e) => {
      onFirst();
      this.down.add(`Mouse${e.button}`);
      this.pressed.add(`Mouse${e.button}`);
    });
    addEventListener('mouseup', (e) => this.down.delete(`Mouse${e.button}`));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('blur', () => this.down.clear());
  }

  held(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }
  hit(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }
  /** Forgets presses once a simulated frame has read them. */
  flush(): void {
    this.pressed.clear();
  }
}
