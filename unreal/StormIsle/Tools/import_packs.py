"""Imports the free CC0 model packs into /Game/Packs. Run it through Tools/get_packs.sh, which
downloads and unpacks them into ../_downloads first. The packs are not kept in the repository.

Kenney Survival Kit (kenney.nl, CC0)  ->  /Game/Packs/Kenney/<name>   buildings, campfire, tools
Every Kenney model shares one colour atlas, so they all get one material, M_KenneyAtlas.

Prints the size of each imported mesh, which the game code uses to scale them.
"""
import os
import sys
import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
DOWN = os.path.normpath(os.path.join(PROJECT, "..", "_downloads"))
tools = unreal.AssetToolsHelpers.get_asset_tools()
eal = unreal.EditorAssetLibrary
mel = unreal.MaterialEditingLibrary
MP = unreal.MaterialProperty

KENNEY_DIR = os.path.join(DOWN, "kenney", "survival-kit", "Models", "FBX format")
KENNEY = [
    "floor", "floor-old", "tree-log", "structure-floor", "structure", "structure-roof", "fence-fortified", "fence", "fence-doorway",
    "campfire-pit", "campfire-stand", "tool-axe", "tool-pickaxe", "tool-hammer", "resource-wood",
    "resource-stone", "resource-planks", "rock-a", "rock-b", "rock-c", "tree", "tree-tall",
    "tree-autumn", "grass", "grass-large", "patch-grass", "tent", "workbench", "chest", "barrel",
    "box", "signpost", "bedroll",
]


def fbx_options():
    o = unreal.FbxImportUI()
    o.import_mesh = True
    o.import_materials = False
    o.import_textures = False
    o.import_animations = False
    o.import_as_skeletal = False
    o.mesh_type_to_import = unreal.FBXImportType.FBXIT_STATIC_MESH
    sm = o.static_mesh_import_data
    sm.combine_meshes = True
    sm.generate_lightmap_u_vs = False
    sm.auto_generate_collision = False
    sm.import_uniform_scale = 100.0     # Kenney works in metres
    return o


def import_atlas():
    t = unreal.AssetImportTask()
    t.filename = os.path.join(KENNEY_DIR, "Textures", "colormap.png")
    t.destination_path = "/Game/Packs/Kenney"
    t.destination_name = "T_KenneyAtlas"
    t.automated = True
    t.replace_existing = True
    t.save = True
    tools.import_asset_tasks([t])
    tex = unreal.load_asset("/Game/Packs/Kenney/T_KenneyAtlas")
    tex.set_editor_property("filter", unreal.TextureFilter.TF_NEAREST)   # flat colour swatches
    eal.save_loaded_asset(tex)
    return tex


def atlas_material(tex):
    path = "/Game/Packs/Kenney/M_KenneyAtlas"
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    m = tools.create_asset("M_KenneyAtlas", "/Game/Packs/Kenney", unreal.Material, unreal.MaterialFactoryNew())
    s = mel.create_material_expression(m, unreal.MaterialExpressionTextureSample, -400, 0)
    s.set_editor_property("texture", tex)
    tint = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -400, 250)
    tint.set_editor_property("parameter_name", "Color")
    tint.set_editor_property("default_value", unreal.LinearColor(1, 1, 1, 1))
    mul = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -150, 50)
    mel.connect_material_expressions(s, "RGB", mul, "A")
    mel.connect_material_expressions(tint, "", mul, "B")
    # Per instance, like M_Prop: 0 = shade (0..1 -> 0.8..1.1 brightness), 1 = hit flash.
    shade = mel.create_material_expression(m, unreal.MaterialExpressionPerInstanceCustomData, -600, 400)
    shade.set_editor_property("data_index", 0)
    shade.set_editor_property("const_default_value", 0.5)
    k = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -600, 500)
    k.set_editor_property("r", 0.3)
    sk = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -400, 450)
    mel.connect_material_expressions(shade, "", sk, "A")
    mel.connect_material_expressions(k, "", sk, "B")
    base = mel.create_material_expression(m, unreal.MaterialExpressionAdd, -250, 450)
    mel.connect_material_expressions(sk, "", base, "A")
    b0 = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -400, 550)
    b0.set_editor_property("r", 0.8)
    mel.connect_material_expressions(b0, "", base, "B")
    shaded = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -50, 200)
    mel.connect_material_expressions(mul, "", shaded, "A")
    mel.connect_material_expressions(base, "", shaded, "B")
    mel.connect_material_property(shaded, "", MP.MP_BASE_COLOR)
    flash = mel.create_material_expression(m, unreal.MaterialExpressionPerInstanceCustomData, -600, 700)
    flash.set_editor_property("data_index", 1)
    flash.set_editor_property("const_default_value", 0.0)
    warm = mel.create_material_expression(m, unreal.MaterialExpressionConstant3Vector, -600, 800)
    warm.set_editor_property("constant", unreal.LinearColor(1.0, 0.85, 0.6, 1))
    em = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -250, 700)
    mel.connect_material_expressions(flash, "", em, "A")
    mel.connect_material_expressions(warm, "", em, "B")
    mel.connect_material_property(em, "", MP.MP_EMISSIVE_COLOR)
    rough = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -150, 250)
    rough.set_editor_property("r", 0.8)
    mel.connect_material_property(rough, "", MP.MP_ROUGHNESS)
    m.set_editor_property("used_with_instanced_static_meshes", True)
    mel.recompile_material(m)
    eal.save_loaded_asset(m)
    return m


def import_kenney(mat):
    tasks = []
    for name in KENNEY:
        f = os.path.join(KENNEY_DIR, name + ".fbx")
        if not os.path.exists(f):
            unreal.log_warning("missing " + f)
            continue
        t = unreal.AssetImportTask()
        t.filename = f
        t.destination_path = "/Game/Packs/Kenney"
        t.destination_name = "SM_" + name.replace("-", "_")
        t.automated = True
        t.replace_existing = True
        t.save = True
        t.options = fbx_options()
        tasks.append(t)
    tools.import_asset_tasks(tasks)
    for name in KENNEY:
        p = "/Game/Packs/Kenney/SM_" + name.replace("-", "_")
        mesh = unreal.load_asset(p)
        if not mesh:
            continue
        for i in range(len(mesh.static_materials)):
            mesh.set_material(i, mat)
        eal.save_loaded_asset(mesh)
        b = mesh.get_bounding_box()
        unreal.log_warning("PACKSIZE %s min=(%.0f,%.0f,%.0f) max=(%.0f,%.0f,%.0f)" % (
            p, b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z))


if os.path.isdir(KENNEY_DIR):
    import_kenney(atlas_material(import_atlas()))
else:
    unreal.log_error("Kenney Survival Kit not found in " + KENNEY_DIR)
