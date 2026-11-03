import { Quaternion } from 'three';

/** One recorded motion, sampled at a fixed rate, with every bone's rotation per frame (x, y, z, w). */
export interface Clip {
  name: string;
  fps: number;
  duration: number;
  /** When the blade lands, in seconds into the clip. */
  strike: number;
  bones: Record<string, Array<[number, number, number, number]>>;
  /** How far the hips sit above their rest height, per frame, in the recording's own metres. */
  hipsY: number[];
}

export interface ClipLibrary {
  fps: number;
  restHipsY: number;
  clips: Clip[];
}

/** Which recorded clip plays for each hit of the combo. */
export const COMBO_CLIPS = ['Sword_Regular_A', 'Sword_Regular_B', 'Sword_Regular_C', 'Sword_Heavy_Combo'];

export const loadClips = async (url: string): Promise<ClipLibrary> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}`);
  return (await response.json()) as ClipLibrary;
};

const smooth = (u: number): number => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

/**
 * Maps the game's progress through a hit (0 to 1, with the blade landing at `strikeAt`) onto the clip's own
 * time, so the recorded strike lands exactly when the game's damage does, however long either one runs.
 */
export const clipTime = (clip: Clip, progress: number, strikeAt: number): number => {
  const t = Math.min(1, Math.max(0, progress));
  const time =
    t < strikeAt
      ? (t / strikeAt) * clip.strike
      : clip.strike + ((t - strikeAt) / (1 - strikeAt)) * (clip.duration - clip.strike);
  return Math.min(clip.duration, Math.max(0, time));
};

/** How strongly the recorded pose replaces the walking pose: eased in at the start and out at the end. */
export const clipWeight = (progress: number): number => smooth(progress / 0.12) * (1 - smooth((progress - 0.72) / 0.28));

const a = new Quaternion();
const b = new Quaternion();

/** A bone's rotation at a time in the clip, blended between the two nearest frames. */
export const sampleBone = (clip: Clip, bone: string, time: number, into: Quaternion): Quaternion => {
  const frames = clip.bones[bone];
  const position = Math.min(frames.length - 1, Math.max(0, time * clip.fps));
  const i = Math.floor(position);
  const next = Math.min(frames.length - 1, i + 1);
  a.fromArray(frames[i]);
  b.fromArray(frames[next]);
  return into.copy(a).slerp(b, position - i);
};

export const sampleHipsY = (clip: Clip, time: number): number => {
  const position = Math.min(clip.hipsY.length - 1, Math.max(0, time * clip.fps));
  const i = Math.floor(position);
  const next = Math.min(clip.hipsY.length - 1, i + 1);
  return clip.hipsY[i] + (clip.hipsY[next] - clip.hipsY[i]) * (position - i);
};
