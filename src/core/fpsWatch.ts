/**
 * Watches real frame times and says when the device cannot keep up. One slow stretch is often
 * just loading, so it takes two slow windows in a row, and it fires only once.
 */
export class FpsWatch {
  private time = 0;
  private frames = 0;
  private slowWindows = 0;
  private finished = false;

  constructor(
    private readonly windowSeconds = 5,
    private readonly minFps = 36,
    private readonly stallSeconds = 0.5,
  ) {}

  /** Stops watching, e.g. once the player has chosen a quality themselves. */
  stop(): void {
    this.finished = true;
  }

  /** Feed each frame's real duration; returns true the one time quality should drop. */
  add(seconds: number): boolean {
    // A frame this long is a stall (tab switch, pause), not a measure of speed.
    if (this.finished || seconds > this.stallSeconds) return false;
    this.time += seconds;
    this.frames++;
    if (this.time < this.windowSeconds) return false;
    const fps = this.frames / this.time;
    this.time = 0;
    this.frames = 0;
    this.slowWindows = fps < this.minFps ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2) return false;
    this.finished = true;
    return true;
  }
}
