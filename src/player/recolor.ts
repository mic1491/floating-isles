import { Source, type Material, type Mesh, type Object3D, type Texture } from 'three';

/** The painted parts that carry a character's identity; skin, face lines and shoes stay as drawn. */
const TARGETS = /HAIR|Tops_|EyeIris/;
const SLOTS = ['map', 'shadeMultiplyTexture'] as const;
const MAX_SIZE = 512;

/** The standard hue-rotation matrix, acting on sRGB values the way the CSS hue-rotate filter does. */
const hueMatrix = (degrees: number): number[] => {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
};

const rotated = (texture: Texture, degrees: number): Texture => {
  const image = texture.image as CanvasImageSource & { width: number; height: number };
  // Painted hair and cloth hold up fine at half size, and a quarter of the pixels is a quarter of the stall.
  const scale = Math.min(1, MAX_SIZE / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  const m = hueMatrix(degrees);
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    data[i] = m[0] * r + m[1] * g + m[2] * b;
    data[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    data[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
  context.putImageData(pixels, 0, 0);
  // A clone keeps the flip, colour space and wrapping the model was authored with.
  const copy = texture.clone();
  copy.source = new Source(canvas);
  copy.needsUpdate = true;
  return copy;
};

/** Gives a model its own look by turning the hue of its hair, jacket and eyes. */
export const shiftHue = (scene: Object3D, degrees: number): void => {
  const done = new Map<Texture, Texture>();
  scene.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    const materials: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!TARGETS.test(material.name)) continue;
      const slots = material as unknown as Record<string, Texture | null | undefined>;
      for (const slot of SLOTS) {
        const source = slots[slot];
        if (!source?.image) continue;
        if (!done.has(source)) done.set(source, rotated(source, degrees));
        slots[slot] = done.get(source)!;
      }
      material.needsUpdate = true;
    }
  });
};
