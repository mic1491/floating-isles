import type { StoryLine } from '../story/story';

const SPEED = 38;

/** The story's text box: a speaker's name and a line that types itself out; any key or tap finishes it, then moves on. */
export class DialogueView {
  private readonly box: HTMLElement;
  private readonly name: HTMLElement;
  private readonly body: HTMLElement;
  private readonly hint: HTMLElement;
  private text = '';
  private shown = 0;

  constructor(
    root: HTMLElement,
    private readonly onAdvance: () => void,
  ) {
    this.box = document.createElement('div');
    this.box.className = 'dialogue';
    this.box.hidden = true;
    this.name = document.createElement('div');
    this.name.className = 'dialogue-name';
    this.body = document.createElement('div');
    this.body.className = 'dialogue-text';
    this.hint = document.createElement('div');
    this.hint.className = 'dialogue-hint';
    this.hint.textContent = '▼';
    this.box.append(this.name, this.body, this.hint);
    root.append(this.box);
    this.box.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.press();
    });
    addEventListener('keydown', (event) => {
      if (this.box.hidden || !['Enter', 'Space', 'KeyF', 'KeyE'].includes(event.code)) return;
      event.preventDefault();
      this.press();
    });
  }

  get visible(): boolean {
    return !this.box.hidden;
  }

  show(line: StoryLine | null): void {
    this.box.hidden = line === null;
    if (!line) return;
    this.name.textContent = line.speaker;
    this.text = line.text;
    this.shown = 0;
    this.body.textContent = '';
    this.hint.style.visibility = 'hidden';
  }

  /** Types the line out a few characters at a time. */
  update(dt: number): void {
    if (this.box.hidden || this.shown >= this.text.length) return;
    this.shown = Math.min(this.text.length, this.shown + dt * SPEED);
    this.body.textContent = this.text.slice(0, Math.floor(this.shown));
    if (this.shown >= this.text.length) this.hint.style.visibility = 'visible';
  }

  private press(): void {
    if (this.shown < this.text.length) {
      this.shown = this.text.length;
      this.body.textContent = this.text;
      this.hint.style.visibility = 'visible';
      return;
    }
    this.onAdvance();
  }
}
