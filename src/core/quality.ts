export type QualityTier = 'high' | 'low';

export interface QualitySettings {
  pixelRatio: number;
  shadows: boolean;
  bloom: boolean;
  grassCount: number;
}

const maxRatio = () => window.devicePixelRatio || 1;

export const qualitySettings = (tier: QualityTier): QualitySettings =>
  tier === 'high'
    ? { pixelRatio: Math.min(maxRatio(), 2), shadows: true, bloom: true, grassCount: 140000 }
    : { pixelRatio: Math.min(maxRatio(), 1.25), shadows: false, bloom: false, grassCount: 14000 };
