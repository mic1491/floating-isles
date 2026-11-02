import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { addOutline, toonMaterial } from '../render/toon';
import { computePose, type BoneName, type Motion } from './avatarPose';

const BLINK_EVERY = 3.6;
const BLINK_LENGTH = 0.14;

const buildSword = (color: string): Group => {
  const sword = new Group();
  const blade = new Mesh(new BoxGeometry(0.055, 0.018, 0.92), new MeshBasicMaterial({ color }));
  blade.position.z = 0.56;
  const guard = new Mesh(new BoxGeometry(0.2, 0.035, 0.04), toonMaterial('#e0b24a'));
  guard.position.z = 0.09;
  const grip = new Mesh(new BoxGeometry(0.03, 0.03, 0.17), toonMaterial('#5a3424'));
  for (const part of [guard, grip]) addOutline(part);
  sword.add(blade, guard, grip);
  return sword;
};

/** A VRM character posed from code, parented inside the player's view. */
export class Avatar {
  readonly root = new Group();
  private readonly nodes = new Map<BoneName, Object3D>();
  private readonly hips: Object3D;
  private readonly hipsRestY: number;

  private constructor(private readonly vrm: VRM) {
    // VRM 1.0 models face +Z and the player view faces -Z.
    vrm.scene.rotation.y = Math.PI;
    vrm.scene.traverse((node) => {
      node.frustumCulled = false;
      if ((node as Mesh).isMesh) node.castShadow = true;
    });
    this.root.add(vrm.scene);
    this.hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
    this.hipsRestY = this.hips.position.y;
  }

  static async load(url: string, weaponColor: string): Promise<Avatar> {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    VRMUtils.combineSkeletons(gltf.scene);
    const avatar = new Avatar(gltf.userData.vrm as VRM);
    avatar.vrm.humanoid.getNormalizedBoneNode('rightHand')?.add(buildSword(weaponColor));
    return avatar;
  }

  private node(name: BoneName): Object3D | null {
    let node = this.nodes.get(name);
    if (!node) {
      node = this.vrm.humanoid.getNormalizedBoneNode(name) ?? undefined;
      if (node) this.nodes.set(name, node);
    }
    return node ?? null;
  }

  /** Settles hair and cloth at once, so a teleport does not whip them across the map. */
  resetPhysics(): void {
    this.vrm.springBoneManager?.reset();
  }

  update(dt: number, motion: Motion): void {
    const { bones, hipsDrop } = computePose(motion);
    for (const name of Object.keys(bones) as BoneName[]) {
      const [x, y, z] = bones[name];
      this.node(name)?.rotation.set(x, y, z);
    }
    this.hips.position.y = this.hipsRestY - hipsDrop;
    const blink = motion.time % BLINK_EVERY < BLINK_LENGTH ? 1 : 0;
    this.vrm.expressionManager?.setValue('blink', blink);
    this.vrm.update(dt);
  }
}
