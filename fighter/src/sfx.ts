/** Every sound is made on the spot from noise and tones, so the game ships no audio files. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  /** Browsers only allow sound after a click or key press. */
  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      const length = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, length, length);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private burst(volume: number, length: number, from: number, to: number, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + length);
    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + length);
  }

  private tone(volume: number, length: number, from: number, to: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + length);
  }

  swing(): void {
    this.burst(0.12, 0.12, 900, 2600, 'bandpass');
  }
  hit(power: number): void {
    this.burst(0.35 + power * 0.1, 0.1 + power * 0.05, 3200, 300);
    this.tone(0.4 + power * 0.1, 0.12 + power * 0.06, 170 - power * 20, 45);
  }
  block(): void {
    this.tone(0.2, 0.08, 900, 500, 'triangle');
    this.burst(0.15, 0.06, 5000, 1500, 'highpass');
  }
  dash(): void {
    this.burst(0.14, 0.2, 400, 3000, 'bandpass');
  }
  blast(): void {
    this.tone(0.22, 0.35, 900, 180, 'sawtooth');
    this.burst(0.15, 0.3, 2500, 500);
  }
  explode(): void {
    this.burst(0.5, 0.5, 2400, 90);
    this.tone(0.5, 0.45, 110, 30);
  }
  charge(): void {
    this.tone(0.05, 0.22, 220, 520, 'sawtooth');
  }
  ultStart(): void {
    this.tone(0.3, 0.9, 120, 900, 'sawtooth');
    this.burst(0.2, 0.9, 300, 5000, 'bandpass');
  }
  beam(): void {
    this.burst(0.5, 1.3, 3500, 200);
    this.tone(0.4, 1.3, 260, 60, 'sawtooth');
  }
  slam(): void {
    this.burst(0.4, 0.3, 900, 70);
    this.tone(0.45, 0.3, 90, 30);
  }
  bell(): void {
    this.tone(0.3, 0.8, 880, 870, 'triangle');
    this.tone(0.2, 0.8, 1320, 1310, 'sine');
  }
}
