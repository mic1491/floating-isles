import {
  BackSide,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  MeshToonMaterial,
  NearestFilter,
  RedFormat,
} from 'three';

const gradient = new DataTexture(new Uint8Array([135, 185, 230, 255]), 4, 1, RedFormat);
gradient.minFilter = NearestFilter;
gradient.magFilter = NearestFilter;
gradient.needsUpdate = true;

export const toonMaterial = (
  color: string,
  options: { vertexColors?: boolean; emissive?: string } = {},
): MeshToonMaterial =>
  new MeshToonMaterial({
    color: new Color(color),
    gradientMap: gradient,
    vertexColors: options.vertexColors ?? false,
    emissive: new Color(options.emissive ?? '#000000'),
  });

const outlineMaterial = (width: number): MeshBasicMaterial => {
  const material = new MeshBasicMaterial({ color: '#2b2230', side: BackSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = position + normal * ${width.toFixed(3)};`,
    );
  };
  return material;
};

const thin = outlineMaterial(0.022);

/** Inverted-hull outline: a slightly inflated backface shell parented to the mesh. */
export const addOutline = (mesh: Mesh): void => {
  mesh.add(new Mesh(mesh.geometry, thin));
};
