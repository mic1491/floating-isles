import {
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { qualitySettings, type QualitySettings, type QualityTier } from '../core/quality';
import type { DirectionalLight } from 'three';

const PIXEL_SIZE = 3;

export class GameRenderer {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(58, 1, 0.1, 1800);
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private settings!: QualitySettings;
  private pixelArt = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new Vector2(256, 256), 0.18, 0.5, 0.94));
    this.composer.addPass(new OutputPass());

    // Follow the box the page actually gives the canvas. On phones `innerWidth` and `innerHeight` jump
    // around as the browser's bars slide in and out, which left the picture cut off or short of the edge.
    addEventListener('resize', () => this.resize());
    window.visualViewport?.addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  get rendererInfo(): { calls: number; triangles: number } {
    return this.renderer.info.render;
  }

  setQuality(tier: QualityTier, sun: DirectionalLight): void {
    this.settings = qualitySettings(tier);
    this.renderer.shadowMap.enabled = this.settings.shadows;
    sun.castShadow = this.settings.shadows;
    this.scene.traverse((node) => {
      const material = (node as { material?: { needsUpdate: boolean } }).material;
      if (material) material.needsUpdate = true;
    });
    this.resize();
  }

  setPixelArt(on: boolean): void {
    this.pixelArt = on;
    this.resize();
  }

  resize(): void {
    // The first size notice can arrive before quality is chosen; the choice triggers its own resize.
    if (!this.settings) return;
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth || innerWidth;
    const height = canvas.clientHeight || innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Pixel style renders at a third of the resolution and scales up with hard edges.
    const ratio = this.pixelArt ? 1 / PIXEL_SIZE : this.settings.pixelRatio;
    this.renderer.domElement.style.imageRendering = this.pixelArt ? 'pixelated' : '';
    this.renderer.setPixelRatio(ratio);
    // The page's CSS sizes the canvas; the renderer only sets how many pixels it draws.
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(ratio);
    this.composer.setSize(width, height);
  }

  render(): void {
    if (this.settings.bloom) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
