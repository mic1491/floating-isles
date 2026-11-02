export type QualityTier = 'high' | 'low';

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  bloom: boolean;
  grassRadius: number;
  grassDensity: number;
  chunkRadius: number;
}

const maxRatio = () => window.devicePixelRatio || 1;

export const qualitySettings = (tier: QualityTier): QualitySettings =>
  tier === 'high'
    ? { pixelRatio: Math.min(maxRatio(), 2), shadows: true, bloom: true, grassRadius: 44, grassDensity: 12, chunkRadius: 2 }
    : { pixelRatio: Math.min(maxRatio(), 1.25), shadows: false, bloom: false, grassRadius: 24, grassDensity: 4, chunkRadius: 1 };
