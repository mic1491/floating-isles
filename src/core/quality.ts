export type QualityTier = 'high' | 'low';

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  bloom: boolean;
  grassRadius: number;
  grassDensity: number;
  /** Segments per blade of grass. */
  grassRows: number;
  chunkRadius: number;
}

const maxRatio = () => window.devicePixelRatio || 1;

export const qualitySettings = (tier: QualityTier): QualitySettings =>
  tier === 'high'
    ? { pixelRatio: Math.min(maxRatio(), 2), shadows: true, bloom: true, grassRadius: 44, grassDensity: 24, grassRows: 6, chunkRadius: 2 }
    : { pixelRatio: Math.min(maxRatio(), 1.5), shadows: false, bloom: false, grassRadius: 24, grassDensity: 6, grassRows: 3, chunkRadius: 1 };
