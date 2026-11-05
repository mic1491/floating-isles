import raw from '../../data/story.json';

export interface StoryLine {
  speaker: string;
  text: string;
}

export interface StoryBeat {
  id: string;
  when: string;
  lines: StoryLine[];
}

export const BEATS: readonly StoryBeat[] = raw.beats;

/**
 * Plays the story's beats in order. A trigger (the opening, a quest starting or finishing) queues the beats that
 * wait on it; each plays once and is remembered, so a saved game never replays what it has seen.
 */
export class StoryDirector {
  private readonly queue: StoryBeat[] = [];
  private line = 0;
  private readonly seen: Set<string>;

  constructor(seen: readonly string[], private readonly beats: readonly StoryBeat[] = BEATS) {
    this.seen = new Set(seen);
  }

  get seenIds(): string[] {
    return [...this.seen];
  }

  /** Queues every unseen beat that waits on this trigger. */
  trigger(name: string): void {
    for (const beat of this.beats) {
      if (beat.when !== name || this.seen.has(beat.id) || this.queue.includes(beat)) continue;
      this.queue.push(beat);
    }
  }

  /** Plays lines that are not part of the story proper (a villager's chat); they are never remembered. */
  say(lines: StoryLine[]): void {
    if (lines.length === 0 || this.active) return;
    this.queue.push({ id: '', when: '', lines });
    this.line = 0;
  }

  /** Marks beats as seen without playing them, for triggers that a returning player is already past. */
  skip(name: string): void {
    for (const beat of this.beats) if (beat.when === name) this.seen.add(beat.id);
  }

  get active(): boolean {
    return this.queue.length > 0;
  }

  /** The line on screen, or null when nothing is playing. */
  get current(): StoryLine | null {
    return this.queue[0]?.lines[this.line] ?? null;
  }

  /** Moves to the next line, and to the next beat when one ends. Returns true when the beat just finished. */
  advance(): boolean {
    const beat = this.queue[0];
    if (!beat) return false;
    this.line++;
    if (this.line < beat.lines.length) return false;
    if (beat.id) this.seen.add(beat.id);
    this.queue.shift();
    this.line = 0;
    return true;
  }
}
