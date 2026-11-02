"""Builds Ember Wing's sword and exports it as glb.

Run: blender --background --python art/weapons/ember_blade.py -- <out.glb> [preview.png]

Modelled upright (blade along +Z in Blender, grip centre at the origin), in metres. The glTF exporter
turns that into +Y up, and the game rotates it back into the hand. Materials are named so the game can
swap them for its toon shaders: steel, gold, leather, glow.
"""
import math
import sys

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "ember_blade.glb"
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color, metallic=0.0, rough=0.5, emit=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 3.0
    return mat


STEEL = material("steel", (0.82, 0.87, 0.93), 0.9, 0.25)
GOLD = material("gold", (0.85, 0.62, 0.2), 0.9, 0.3)
LEATHER = material("leather", (0.2, 0.1, 0.08), 0.0, 0.8)
GLOW = material("glow", (1.0, 0.35, 0.12), 0.0, 0.4, emit=(1.0, 0.35, 0.12))


def finish(name, bm, mat, bevel=0.0, smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    if bevel:
        mod = obj.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier="bevel")
        obj.select_set(False)
    return obj


def prism(name, outline, thickness, mat, bevel=0.002, mirror=False):
    """Extrudes a 2D outline given as (x, z) points along Y, centred on the XZ plane."""
    bm = bmesh.new()
    pts = list(outline)
    for sign in (1, -1) if mirror else (1,):
        ring = [(x * sign, z) for x, z in (pts if sign == 1 else reversed(pts))]
        lo = [bm.verts.new((x, -thickness / 2, z)) for x, z in ring]
        hi = [bm.verts.new((x, thickness / 2, z)) for x, z in ring]
        bm.faces.new(lo[::-1])
        bm.faces.new(hi)
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            bm.faces.new([lo[i], lo[j], hi[j], hi[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=bm.faces, ngon_method="EAR_CLIP")
    return finish(name, bm, mat, bevel, smooth=False)


def lathe(name, profile, mat, segs=14, bevel=0.0):
    """Revolves (radius, z) points about the Z axis."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append(bm.verts.new((0, 0, z)))
        else:
            rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z))
                          for a in (2 * math.pi * k / segs for k in range(segs))])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segs):
            n = (k + 1) % segs
            if isinstance(a, list) and isinstance(b, list):
                bm.faces.new([a[k], a[n], b[n], b[k]])
            elif isinstance(a, list):
                bm.faces.new([a[k], a[n], b])
            elif isinstance(b, list):
                bm.faces.new([a, b[n], b[k]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(name, bm, mat, bevel)


# --- blade: a six-sided section with a flat top, tapering to a leaf-shaped point ---------------------
# (z, half width, half thickness)
STATIONS = [
    (0.09, 0.030, 0.0100),
    (0.22, 0.036, 0.0105),
    (0.55, 0.034, 0.0095),
    (0.80, 0.031, 0.0085),
    (0.93, 0.024, 0.0065),
    (1.01, 0.012, 0.0035),
    (1.07, 0.0, 0.0),
]


def section(w, h):
    w, h = w * 1.7, h * 1.4  # broad enough to read as a blade from the game camera
    return [(-w, 0), (-0.38 * w, h), (0.38 * w, h), (w, 0), (0.38 * w, -h), (-0.38 * w, -h)]


bm = bmesh.new()
rings = []
for z, w, h in STATIONS:
    if w == 0:
        rings.append(bm.verts.new((0, 0, z)))
    else:
        rings.append([bm.verts.new((x, y, z)) for x, y in section(w, h)])
for i in range(len(rings) - 1):
    a, b = rings[i], rings[i + 1]
    n = 6
    for k in range(n):
        m = (k + 1) % n
        if isinstance(b, list):
            bm.faces.new([a[k], a[m], b[m], b[k]])
        else:
            bm.faces.new([a[k], a[m], b])
bm.faces.new(rings[0][::-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
finish("blade", bm, STEEL, bevel=0.0008, smooth=False)

# Molten fuller: a thin glowing strip inlaid along each face of the blade.
for side in (1, -1):
    strip = [(-0.014, 0.17), (0.014, 0.17), (0.012, 0.84), (0.0, 0.93), (-0.012, 0.84)]
    bm = bmesh.new()
    pts = [bm.verts.new((x, side * 0.0158, z)) for x, z in strip]
    top = [bm.verts.new((x, side * 0.0168, z)) for x, z in strip]
    bm.faces.new(top if side == 1 else top[::-1])
    for i in range(len(strip)):
        j = (i + 1) % len(strip)
        bm.faces.new([pts[i], pts[j], top[j], top[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    finish(f"fuller{side}", bm, GLOW, smooth=False)

# --- crossguard: a pair of swept wings, three feathers each, rising toward the point ------------------
wing = [
    (0.0, 0.045), (0.07, 0.05), (0.15, 0.065), (0.23, 0.095), (0.30, 0.14), (0.33, 0.20),   # leading edge
    (0.27, 0.175), (0.255, 0.20), (0.205, 0.14), (0.19, 0.165), (0.145, 0.105), (0.13, 0.125),
    (0.085, 0.07), (0.0, 0.035),
]
wing = [(x * 1.45, z * 1.3) for x, z in wing]
prism("guard", wing, 0.034, GOLD, bevel=0.0025, mirror=True)
# a central block where the wings meet the blade
prism("guard_core", [(-0.055, 0.03), (0.055, 0.03), (0.05, 0.15), (-0.05, 0.15)], 0.05, GOLD, bevel=0.004)
lathe("collar", [(0.021, 0.0), (0.034, 0.012), (0.034, 0.03), (0.0, 0.03)], GOLD, bevel=0.0015)
for obj in bpy.data.objects:
    if obj.name == "collar":
        obj.location.z = 0.055

# --- grip, ferrule and pommel -------------------------------------------------------------------------
ridge = []
z = -0.11
while z < 0.04:
    ridge += [(0.0185, z), (0.0215, z + 0.006), (0.0185, z + 0.012)]
    z += 0.012
lathe("grip", [(0.0, -0.11)] + ridge + [(0.0, 0.04)], LEATHER, segs=12)
lathe("pommel", [(0.0, -0.17), (0.02, -0.168), (0.034, -0.15), (0.036, -0.13), (0.026, -0.112), (0.0, -0.11)], GOLD, bevel=0.002)
lathe("gem", [(0.0, -0.186), (0.014, -0.175), (0.016, -0.165), (0.0, -0.158)], GLOW, segs=8)

# --- export -------------------------------------------------------------------------------------------
parts = [o for o in bpy.data.objects if o.type == "MESH"]
for o in parts:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)

if PREVIEW:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.render.resolution_x, scene.render.resolution_y = 600, 900
    scene.render.filepath = PREVIEW
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    bpy.context.collection.objects.link(cam)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1.5
    cam.location = Vector((1.2, -2.0, 0.45))
    cam.rotation_euler = (math.radians(90), 0, math.radians(30))
    scene.camera = cam
    bpy.ops.render.render(write_still=True)
