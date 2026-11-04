/** All sound is synthesised on the fly, so the game ships no audio files and owes nobody a licence. */

// C major pentatonic across two octaves: any random mix of these notes sounds pleasant.
const PENTATONIC = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 784, 880];
const MASTER_VOLUME = 0.55;

export class Sfx {
  muted: boolean;
  /** Exposed so tools can tap the output level. */
  master: GainNode | null = null;
  private context: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  get ctx(): AudioContext | null {
    return this.context;
  }

  /** Browsers only allow audio after a gesture, so this is called from the first click or key press. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    this.context = new Context();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    this.master.connect(this.context.destination);
    const length = this.context.sampleRate * 2;
    this.noiseBuffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.startWind();
    this.scheduleChime();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.context.currentTime, 0.05);
  }

  swing(step: number): void {
    this.noise(0.14, 0.1 + step * 0.015, 2400 + step * 500, 900, 'bandpass');
  }

  hit(): void {
    this.noise(0.09, 0.2, 1800, 300, 'lowpass');
    this.tone(190, 0.12, 'sine', 0.22, 70);
  }

  skill(): void {
    this.tone(320, 0.35, 'triangle', 0.16, 980);
    this.noise(0.3, 0.08, 3000, 6000, 'highpass');
    this.tone(1240, 0.3, 'sine', 0.06, 1240, 0.08);
  }

  burst(): void {
    this.tone(110, 0.7, 'sine', 0.35, 38);
    this.noise(0.6, 0.18, 4000, 200, 'lowpass');
    this.arpeggio([392, 523.25, 659.25, 784, 1046.5], 0.07, 0.07, 0.1);
  }

  /** Power gathering, filling and letting go. */
  charge(stage: 'start' | 'full' | 'release'): void {
    if (stage === 'start') {
      this.tone(180, 0.9, 'sine', 0.1, 520);
      this.noise(0.9, 0.05, 600, 3000, 'bandpass');
    } else if (stage === 'full') {
      this.arpeggio([659.25, 880, 1174.66], 0.05, 0.16, 0.09);
      this.tone(90, 0.3, 'sine', 0.2, 140);
    } else {
      this.noise(0.4, 0.22, 800, 5000, 'bandpass');
      this.tone(140, 0.5, 'sawtooth', 0.12, 45);
      this.tone(70, 0.6, 'sine', 0.3, 35, 0.08);
    }
  }

  reaction(): void {
    this.tone(660, 0.18, 'square', 0.07, 1320);
    this.noise(0.18, 0.1, 5000, 1500, 'highpass');
  }

  hurt(): void {
    this.tone(220, 0.22, 'sawtooth', 0.14, 70);
  }

  /** A soft footfall; each one is nudged a little so a run of steps never sounds like a loop. */
  step(speed: number): void {
    const run = Math.min(1, speed / 8.5);
    this.noise(0.07, 0.05 + run * 0.05, 700 + Math.random() * 500, 160, 'lowpass');
  }

  jump(): void {
    this.tone(240, 0.14, 'sine', 0.07, 430);
    this.noise(0.1, 0.04, 1800, 600, 'bandpass');
  }

  land(impact: number): void {
    const weight = Math.min(1, impact / 16);
    this.tone(120, 0.14, 'sine', 0.08 + weight * 0.12, 55);
    this.noise(0.1, 0.06 + weight * 0.1, 900, 150, 'lowpass');
  }

  dash(): void {
    this.noise(0.22, 0.12, 700, 3400, 'bandpass');
  }

  /** The canopy opening: a quick billow of air. */
  glide(): void {
    this.noise(0.4, 0.1, 400, 1800, 'bandpass');
    this.tone(180, 0.3, 'sine', 0.04, 320);
  }

  coin(): void {
    this.tone(1318.5, 0.09, 'triangle', 0.09);
    this.tone(1760, 0.16, 'triangle', 0.09, 1760, 0.07);
  }

  pickup(): void {
    this.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.07, 0.16, 0.12);
  }

  questDone(): void {
    this.arpeggio([392, 493.88, 587.33, 783.99, 987.77, 1174.66], 0.11, 0.3, 0.14);
  }

  upgrade(): void {
    this.arpeggio([659.25, 987.77], 0.1, 0.3, 0.13);
  }

  private tone(from: number, duration: number, type: OscillatorType, volume: number, to = from, delay = 0): void {
    const context = this.context;
    if (!context || !this.master) return;
    const start = context.currentTime + delay;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.02, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private noise(duration: number, volume: number, from: number, to: number, type: BiquadFilterType): void {
    const context = this.context;
    if (!context || !this.master || !this.noiseBuffer) return;
    const start = context.currentTime;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(start, Math.random());
    source.stop(start + duration + 0.05);
  }

  private arpeggio(notes: number[], gap: number, length: number, volume: number): void {
    notes.forEach((note, i) => this.tone(note, length, 'triangle', volume, note, i * gap));
  }

  /** A soft, endless breeze under everything else. */
  private startWind(): void {
    const context = this.context;
    if (!context || !this.master || !this.noiseBuffer) return;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    const gain = context.createGain();
    gain.gain.value = 0.045;
    const swell = context.createOscillator();
    swell.frequency.value = 0.09;
    const depth = context.createGain();
    depth.gain.value = 0.025;
    swell.connect(depth).connect(gain.gain);
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
    swell.start();
  }

  /** Occasional plucked notes, like a music box drifting past; never the same twice. */
  private scheduleChime(): void {
    window.setTimeout(() => {
      const note = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
      this.tone(note, 2.2, 'sine', 0.05);
      this.tone(note * 2, 1.2, 'sine', 0.018);
      if (Math.random() < 0.35) this.tone(PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)], 2, 'sine', 0.04, undefined, 0.35);
      this.scheduleChime();
    }, 1800 + Math.random() * 3200);
  }
}
