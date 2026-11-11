"""Builds the dragon (with a seated rider) as a rigged FBX for Unreal.

Run:  blender --background --python build_dragon.py -- <out.fbx> [preview.png]

The dragon faces +X, Z is up, units are metres. The wings, neck, tail and legs
are driven in the game by code (see DragonPawn.cpp), so no animation is baked.
"""
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "dragon.fbx"
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, rough=0.7):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*color, 1)
    return m


MAT_BODY = material("Dragon_Body", (0.30, 0.17, 0.07), 0.55)
MAT_WING = material("Dragon_Wing", (0.45, 0.27, 0.12), 0.8)
MAT_HORN = material("Dragon_Horn", (0.75, 0.68, 0.55), 0.4)
MAT_RIDER = material("Rider", (0.10, 0.22, 0.50), 0.6)


def skin_object(name, chains, mat, subsurf=2):
    """chains: list of lists of (x, y, z, radius). A point given again (same
    coordinates) reuses the vertex, so chains can branch from each other."""
    verts, radii, edges, index = [], [], [], {}
    for chain in chains:
        prev = None
        for x, y, z, r in chain:
            key = (round(x, 4), round(y, 4), round(z, 4))
            if key not in index:
                index[key] = len(verts)
                verts.append((x, y, z))
                radii.append(r)
            i = index[key]
            if prev is not None:
                edges.append((prev, i))
            prev = i
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, edges, [])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.modifiers.new("Skin", "SKIN")
    for i, r in enumerate(radii):
        mesh.skin_vertices[0].data[i].radius = (r, r)
        mesh.skin_vertices[0].data[i].use_root = (i == 0)
    sub = obj.modifiers.new("Sub", "SUBSURF")
    sub.levels = subsurf
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def mirror(chain):
    return [(x, -y, z, r) for x, y, z, r in chain]


# ---- key points (left side is +Y) -----------------------------------------
HIPS = (-1.2, 0, 0.0)
MID = (0.0, 0, 0.05)
CHEST = (1.2, 0, 0.1)
NECK1 = (2.0, 0, 0.5)
NECK2 = (2.7, 0, 1.0)
NECK3 = (3.3, 0, 1.3)
HEAD = (3.9, 0, 1.35)
SNOUT = (4.8, 0, 1.15)
TAIL = [(-2.3, 0, 0.0), (-3.5, 0, 0.05), (-4.7, 0, 0.08), (-5.9, 0, 0.1), (-7.0, 0, 0.14), (-8.0, 0, 0.2)]
TAIL_R = [0.42, 0.31, 0.22, 0.15, 0.09, 0.04]

W_SHOULDER = (1.0, 0.45, 0.55)
W_ELBOW = (0.5, 2.6, 1.0)
W_WRIST = (1.5, 4.6, 0.9)
W_F1 = (0.7, 8.6, 0.6)
W_F2 = (-1.7, 7.2, 0.5)
W_F3 = (-2.8, 4.6, 0.4)
W_THUMB = (2.2, 4.9, 0.95)
W_BODY_REAR = (-1.5, 0.4, 0.25)

FL = [(1.2, 0.55, -0.25), (1.55, 0.8, -1.0), (1.25, 0.8, -1.6), (1.75, 0.8, -1.72)]
RL = [(-1.2, 0.5, -0.25), (-0.75, 0.8, -1.0), (-1.4, 0.8, -1.5), (-0.95, 0.8, -1.7)]

# ---- dragon body -----------------------------------------------------------
spine = [(*HIPS, 0.58), (*MID, 0.72), (*CHEST, 0.76), (*NECK1, 0.44), (*NECK2, 0.34),
         (*NECK3, 0.30), (*HEAD, 0.38), (*SNOUT, 0.20)]
tail = [(*HIPS, 0.58)] + [(*p, r) for p, r in zip(TAIL, TAIL_R)]
wing_arm = [(*CHEST, 0.76), (*W_SHOULDER, 0.30), (*W_ELBOW, 0.17), (*W_WRIST, 0.13)]
fingers = [
    [(*W_WRIST, 0.13), (*W_F1, 0.035)],
    [(*W_WRIST, 0.13), (*W_F2, 0.035)],
    [(*W_WRIST, 0.13), (*W_F3, 0.035)],
    [(*W_WRIST, 0.13), (*W_THUMB, 0.03)],
]
front_leg = [(*CHEST, 0.76), (*FL[0], 0.32), (*FL[1], 0.20), (*FL[2], 0.14), (*FL[3], 0.08)]
rear_leg = [(*HIPS, 0.58), (*RL[0], 0.38), (*RL[1], 0.23), (*RL[2], 0.14), (*RL[3], 0.08)]

chains = [spine, tail]
for c in [wing_arm, *fingers, front_leg, rear_leg]:
    chains += [c, mirror(c)]
body = skin_object("DragonBody", chains, MAT_BODY)

# ---- horns, back spikes ----------------------------------------------------
horn_chains = []
for s in (1, -1):
    horn_chains.append([(3.85, 0.22 * s, 1.6, 0.11), (3.3, 0.42 * s, 2.0, 0.07), (2.7, 0.55 * s, 2.25, 0.02)])
    horn_chains.append([(3.8, 0.33 * s, 1.35, 0.08), (3.3, 0.7 * s, 1.5, 0.02)])
horns = [skin_object(f"Horn{i}", [c], MAT_HORN, 1) for i, c in enumerate(horn_chains)]
spikes = []
back = [NECK2, NECK1, CHEST, MID, HIPS] + TAIL[:4]
back_r = [0.34, 0.44, 0.76, 0.72, 0.58] + TAIL_R[:4]
for i in range(len(back) - 1):
    for t in (0.25, 0.75):
        p = Vector(back[i]).lerp(Vector(back[i + 1]), t)
        r = back_r[i] + (back_r[i + 1] - back_r[i]) * t
        if 0.0 < p.x < 0.9:
            continue  # the saddle goes here
        base = (p.x, 0, p.z + r * 0.8)
        tip = (p.x - 0.18, 0, p.z + r * 0.8 + 0.2 + r * 0.45)
        spikes.append(skin_object("Spike", [[(*base, 0.07), (*tip, 0.015)]], MAT_HORN, 1))


# ---- wing membranes --------------------------------------------------------
def membrane(sign):
    def P(p):
        return (p[0], p[1] * sign, p[2])
    pts = [P(W_WRIST), P(W_F1), P(W_F2), P(W_F3), P(W_BODY_REAR), P(W_ELBOW), P(W_SHOULDER)]
    faces = [(0, 1, 2), (0, 2, 3), (0, 3, 4), (0, 4, 5), (5, 4, 6)]
    if sign < 0:
        faces = [f[::-1] for f in faces]
    mesh = bpy.data.meshes.new("Membrane")
    mesh.from_pydata(pts, [], faces)
    obj = bpy.data.objects.new("Membrane", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.subdivide(number_cuts=5)
    bpy.ops.object.mode_set(mode="OBJECT")
    sol = obj.modifiers.new("Solid", "SOLIDIFY")
    sol.thickness = 0.03
    sol.offset = 0
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    obj.data.materials.append(MAT_WING)
    return obj


membranes = [membrane(1), membrane(-1)]

# ---- rider -----------------------------------------------------------------
R_PELVIS = (0.35, 0, 0.82)
R_CHEST = (0.42, 0, 1.38)
R_HEAD = (0.48, 0, 1.80)
rider_chains = [[(*R_PELVIS, 0.17), (*R_CHEST, 0.21), (0.45, 0, 1.6, 0.09), (*R_HEAD, 0.17)]]
for s in (1, -1):
    rider_chains.append([(*R_CHEST, 0.21), (0.42, 0.27 * s, 1.42, 0.09), (0.7, 0.33 * s, 1.15, 0.07), (1.0, 0.18 * s, 1.0, 0.06)])
    rider_chains.append([(*R_PELVIS, 0.17), (0.5, 0.45 * s, 0.6, 0.11), (0.45, 0.78 * s, 0.1, 0.08), (0.65, 0.8 * s, -0.05, 0.06)])
rider = skin_object("RiderMesh", rider_chains, MAT_RIDER)

# ---- join ------------------------------------------------------------------
for o in [body, *horns, *spikes, *membranes, rider]:
    o.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
dragon = body
dragon.name = "Dragon"

# ---- armature --------------------------------------------------------------
bones = [  # name, head, tail, parent
    ("root", (0, 0, 0), (0.3, 0, 0), None),
    ("pelvis", MID, HIPS, "root"),
    ("chest", MID, CHEST, "root"),
    ("neck1", CHEST, NECK1, "chest"),
    ("neck2", NECK1, NECK2, "neck1"),
    ("neck3", NECK2, NECK3, "neck2"),
    ("head", NECK3, SNOUT, "neck3"),
]
prev, prev_name = HIPS, "pelvis"
for i, p in enumerate(TAIL):
    bones.append((f"tail{i + 1}", prev, p, prev_name))
    prev, prev_name = p, f"tail{i + 1}"
for side, s in (("l", 1), ("r", -1)):
    def P(p, s=s):
        return (p[0], p[1] * s, p[2])
    bones += [
        (f"wing_upper_{side}", P(W_SHOULDER), P(W_ELBOW), "chest"),
        (f"wing_fore_{side}", P(W_ELBOW), P(W_WRIST), f"wing_upper_{side}"),
        (f"finger1_{side}", P(W_WRIST), P(W_F1), f"wing_fore_{side}"),
        (f"finger2_{side}", P(W_WRIST), P(W_F2), f"wing_fore_{side}"),
        (f"finger3_{side}", P(W_WRIST), P(W_F3), f"wing_fore_{side}"),
        (f"leg_f_upper_{side}", P(FL[0]), P(FL[1]), "chest"),
        (f"leg_f_lower_{side}", P(FL[1]), P(FL[3]), f"leg_f_upper_{side}"),
        (f"leg_r_upper_{side}", P(RL[0]), P(RL[1]), "pelvis"),
        (f"leg_r_lower_{side}", P(RL[1]), P(RL[3]), f"leg_r_upper_{side}"),
    ]

arm_data = bpy.data.armatures.new("Armature")
arm = bpy.data.objects.new("Armature", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.ops.object.select_all(action="DESELECT")
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for name, h, t, parent in bones:
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = h, t
    if parent:
        b.parent = arm_data.edit_bones[parent]
bpy.ops.object.mode_set(mode="OBJECT")


# ---- weights: nearest bone segments ---------------------------------------
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


segs = [(n, Vector(h), Vector(t)) for n, h, t, _ in bones if n != "root"]
groups = {n: dragon.vertex_groups.new(name=n) for n, *_ in bones}
rider_mat = list(dragon.data.materials).index(MAT_RIDER)
rider_verts = set()
for poly in dragon.data.polygons:
    if poly.material_index == rider_mat:
        rider_verts.update(poly.vertices)

for v in dragon.data.vertices:
    if v.index in rider_verts:
        groups["chest"].add([v.index], 1.0, "REPLACE")
        continue
    p = v.co
    cands = []
    for n, a, b in segs:
        if (p.y > 0.15 and n.endswith("_r")) or (p.y < -0.15 and n.endswith("_l")):
            continue
        cands.append((seg_dist(p, a, b), n))
    cands.sort()
    top = cands[:3]
    w = [1.0 / (d ** 4 + 1e-5) for d, _ in top]
    total = sum(w)
    for (d, n), wi in zip(top, w):
        if wi / total > 0.02:
            groups[n].add([v.index], wi / total, "REPLACE")

mod = dragon.modifiers.new("Armature", "ARMATURE")
mod.object = arm
dragon.parent = arm

# ---- export ----------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
dragon.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.fbx(
    filepath=OUT, use_selection=True, object_types={"ARMATURE", "MESH"},
    add_leaf_bones=False, bake_anim=False, mesh_smooth_type="FACE",
)
print("exported", OUT, "verts", len(dragon.data.vertices), "tris", sum(len(p.vertices) - 2 for p in dragon.data.polygons))

# ---- preview render (wings posed a little, to check the weights) ----------
if PREVIEW:
    import math
    for side, s in (("l", 1), ("r", -1)):
        pb = arm.pose.bones[f"wing_upper_{side}"]
        pb.rotation_mode = "QUATERNION"
        from mathutils import Quaternion
        world = Quaternion((1, 0, 0), math.radians(25) * s)
        rest = pb.bone.matrix_local.to_quaternion()
        pb.rotation_quaternion = rest.inverted() @ world @ rest
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (13, -13, 7)
    direction = Vector((0, 0, 0.5)) - cam.location
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    sun_data = bpy.data.lights.new("Sun", "SUN")
    sun_data.energy = 4
    sun = bpy.data.objects.new("Sun", sun_data)
    sun.rotation_euler = (0.7, 0.2, 0.5)
    scene.collection.objects.link(sun)
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.7, 0.8, 1, 1)
    scene.world = world
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 1100, 800
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
