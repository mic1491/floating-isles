"""Builds the rider as a static FBX for Unreal: a seated figure with its hands forward.

Run:  Blender --background --python build_rider.py -- <out.fbx>

The rider faces +X, Z is up, units are metres and the origin is at the hips, which is the
point the game seats on the dragon's back (see DragonPawn.cpp).
"""
import sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "rider.fbx"
bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, color):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    return m


CLOAK = material("Rider_Cloak", (0.07, 0.16, 0.42))
SKIN = material("Rider_Skin", (0.75, 0.55, 0.40))


def skin_object(name, chains, mat):
    """chains: lists of (x, y, z, radius); a repeated point joins the chains there."""
    verts, radii, edges, index = [], [], [], {}
    for chain in chains:
        prev = None
        for x, y, z, r in chain:
            key = (round(x, 4), round(y, 4), round(z, 4))
            if key not in index:
                index[key] = len(verts)
                verts.append((x, y, z))
                radii.append(r)
            if prev is not None:
                edges.append((prev, index[key]))
            prev = index[key]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, edges, [])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.modifiers.new("Skin", "SKIN")
    for i, r in enumerate(radii):
        mesh.skin_vertices[0].data[i].radius = (r, r)
        mesh.skin_vertices[0].data[i].use_root = (i == 0)
    obj.modifiers.new("Sub", "SUBSURF").levels = 2
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    obj.select_set(False)
    obj.data.materials.append(mat)
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


HIPS = (0.0, 0, 0.0)
CHEST = (0.10, 0, 0.56)
body = [[(*HIPS, 0.17), (*CHEST, 0.21), (0.12, 0, 0.74, 0.09), (0.14, 0, 0.93, 0.16)]]
for s in (1, -1):
    # arms reach forward to hold on; legs straddle the dragon's back
    body.append([(*CHEST, 0.21), (0.10, 0.27 * s, 0.60, 0.09), (0.36, 0.33 * s, 0.33, 0.07), (0.62, 0.18 * s, 0.18, 0.06)])
    body.append([(*HIPS, 0.17), (0.16, 0.42 * s, -0.20, 0.11), (0.10, 0.62 * s, -0.66, 0.08), (0.30, 0.64 * s, -0.80, 0.06)])
torso = skin_object("Torso", body, CLOAK)
# The head is the top of the same body; its faces take the skin colour.
torso.data.materials.append(SKIN)
for poly in torso.data.polygons:
    if poly.center.z > 0.80:
        poly.material_index = 1
torso.select_set(True)
bpy.context.view_layer.objects.active = torso
torso.name = "Rider"
bpy.ops.export_scene.fbx(filepath=OUT, use_selection=True, object_types={"MESH"}, mesh_smooth_type="FACE")
print("exported", OUT)
