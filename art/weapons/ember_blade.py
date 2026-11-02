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
BLADE = material("blade", (1.0, 1.0, 1.0), 0.0, 0.5)
GEM = material("gem", (0.2, 0.85, 1.0), 0.0, 0.2, emit=(0.2, 0.85, 1.0))
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


# --- blade: broad, stepped at the shoulder, with a swept tip and a two-tone face ----------------------
# (z, half width, half thickness, sideways shift of the centre line)
STATIONS = [
    (0.09, 0.034, 0.0125, 0.0),
    (0.20, 0.034, 0.0125, 0.0),
    (0.215, 0.054, 0.0135, 0.0),   # the shoulder: an abrupt step out from the ricasso
    (0.60, 0.054, 0.0125, 0.0),
    (0.86, 0.051, 0.0110, 0.0),
    (0.97, 0.040, 0.0085, 0.004),
    (1.06, 0.017, 0.0045, 0.018),
    (1.115, 0.0, 0.0, 0.032),      # the point sits off-centre, which gives the tip its slant
]
SILVER = (0.94, 0.96, 0.99)
RAMP = [(0.0, (0.35, 0.07, 0.11)), (0.45, (0.80, 0.20, 0.12)), (1.0, (1.0, 0.72, 0.30))]


def srgb(c):
    return tuple(v ** 2.2 for v in c)


def ramp(t):
    for (t0, c0), (t1, c1) in zip(RAMP, RAMP[1:]):
        if t <= t1:
            u = (t - t0) / (t1 - t0)
            return tuple(a + (b - a) * u for a, b in zip(c0, c1))
    return RAMP[-1][1]


def section(w, h, shift):
    pts = [(-w, 0), (-0.42 * w, h), (0.42 * w, h), (w, 0), (0.42 * w, -h), (-0.42 * w, -h)]
    return [(x + shift, y) for x, y in pts]


bm = bmesh.new()
tint = {}
rings = []
for z, w, h, shift in STATIONS:
    if w == 0:
        v = bm.verts.new((shift, 0, z))
        tint[v] = srgb(ramp(1.0))
        rings.append(v)
        continue
    ring = []
    for k, (x, y) in enumerate(section(w, h, shift)):
        v = bm.verts.new((x, y, z))
        # Edges stay bright steel; the faces fade from deep crimson at the hilt to molten gold at the tip.
        tint[v] = srgb(SILVER if k in (0, 3) else ramp(min(1.0, max(0.0, (z - 0.2) / 0.85))))
        ring.append(v)
    rings.append(ring)
for i in range(len(rings) - 1):
    a, b = rings[i], rings[i + 1]
    for k in range(6):
        m = (k + 1) % 6
        if isinstance(b, list):
            bm.faces.new([a[k], a[m], b[m], b[k]])
        else:
            bm.faces.new([a[k], a[m], b])
bm.faces.new(rings[0][::-1])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
layer = bm.loops.layers.color.new("Col")
for face in bm.faces:
    for loop in face.loops:
        loop[layer] = (*tint[loop.vert], 1.0)
finish("blade", bm, BLADE, bevel=0.0, smooth=False)

# Rune diamonds inlaid down both faces, shrinking toward the tip.
for side in (1, -1):
    for z, size in ((0.34, 0.034), (0.47, 0.030), (0.59, 0.026), (0.70, 0.021), (0.80, 0.016)):
        bm = bmesh.new()
        outline = [(0, -size), (size * 0.5, 0), (0, size), (-size * 0.5, 0)]
        low = [bm.verts.new((x, side * 0.0128, z + y)) for x, y in outline]
        high = [bm.verts.new((x * 0.55, side * 0.0152, z + y * 0.55)) for x, y in outline]
        bm.faces.new(high if side == 1 else high[::-1])
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new([low[i], low[j], high[j], high[i]])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        finish(f"rune{side}_{int(z * 100)}", bm, GLOW, smooth=False)

# --- crossguard: two layers of swept wings, gold behind and white in front, around a jewel -------------
wing = [
    (0.0, 0.045), (0.07, 0.05), (0.15, 0.065), (0.23, 0.095), (0.30, 0.14), (0.33, 0.20),
    (0.27, 0.175), (0.255, 0.20), (0.205, 0.14), (0.19, 0.165), (0.145, 0.105), (0.13, 0.125),
    (0.085, 0.07), (0.0, 0.035),
]
back = [(x * 1.5, z * 1.35) for x, z in wing]
front = [(x * 1.0, z * 1.0 + 0.012) for x, z in wing]
for name, outline, mat, depth, y in (("wing_back", back, GOLD, 0.03, -0.012), ("wing_front", front, STEEL, 0.026, 0.02)):
    obj = prism(name, outline, depth, mat, bevel=0.0025, mirror=True)
    obj.location.y = y
prism("guard_core", [(-0.06, 0.03), (0.06, 0.03), (0.052, 0.16), (-0.052, 0.16)], 0.055, GOLD, bevel=0.004)
lathe("collar", [(0.021, 0.0), (0.036, 0.012), (0.036, 0.03), (0.0, 0.03)], GOLD, bevel=0.0015)
for obj in bpy.data.objects:
    if obj.name == "collar":
        obj.location.z = 0.06
# A faceted jewel set in the face of the guard, in a colour that stands apart from the gold and red.
gem = lathe("jewel", [(0.0, -0.03), (0.026, -0.005), (0.026, 0.005), (0.0, 0.03)], GEM, segs=4)
gem.rotation_euler = (math.radians(90), 0, 0)
gem.location = (0, 0.04, 0.1)
bpy.context.view_layer.update()

# --- grip, ferrule and pommel -------------------------------------------------------------------------
ridge = []
z = -0.11
while z < 0.04:
    ridge += [(0.0185, z), (0.0215, z + 0.006), (0.0185, z + 0.012)]
    z += 0.012
lathe("grip", [(0.0, -0.11)] + ridge + [(0.0, 0.04)], LEATHER, segs=12)
for z in (-0.075, -0.02):
    lathe(f"band{int(z * 100)}", [(0.024, z - 0.006), (0.027, z), (0.024, z + 0.006), (0.0, z + 0.006), (0.0, z - 0.006)], GOLD, segs=12)
lathe("pommel", [(0.0, -0.17), (0.02, -0.168), (0.034, -0.15), (0.036, -0.13), (0.026, -0.112), (0.0, -0.11)], GOLD, bevel=0.002)
lathe("pommel_gem", [(0.0, -0.186), (0.014, -0.175), (0.016, -0.165), (0.0, -0.158)], GEM, segs=8)

# --- export -------------------------------------------------------------------------------------------
parts = [o for o in bpy.data.objects if o.type == "MESH"]
for o in parts:
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_apply=True, export_yup=True, export_vertex_color="ACTIVE")

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
