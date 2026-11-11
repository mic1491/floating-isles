"""Creates the project's assets inside the Unreal editor. Run once, and again whenever
SourceArt/dragon.fbx changes:

    UnrealEditor-Cmd DragonRider.uproject -run=pythonscript -script=Tools/setup_assets.py

or in the editor: Tools > Execute Python Script.

Makes  /Game/Dragon/SK_Dragon      the dragon and rider, from SourceArt/dragon.fbx
       /Game/Materials/M_Terrain   lit, coloured by the terrain's vertex colours
       /Game/Materials/M_Glow      glowing, with a "Color" parameter (rings)
       /Game/Materials/M_Water     dark and shiny, with a "Color" parameter (sea)
"""
import os
import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
FBX = os.path.join(PROJECT, "SourceArt", "dragon.fbx")
tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary


def import_dragon():
    opts = unreal.FbxImportUI()
    opts.import_mesh = True
    opts.import_as_skeletal = True
    opts.import_animations = False
    opts.import_materials = True
    opts.import_textures = False
    opts.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH
    task = unreal.AssetImportTask()
    task.filename = FBX
    task.destination_path = "/Game/Dragon"
    task.destination_name = "SK_Dragon"
    task.automated = True
    task.replace_existing = True
    task.save = True
    task.options = opts
    tools.import_asset_tasks([task])
    # Whatever name the importer chose, the game looks for /Game/Dragon/SK_Dragon.
    if not eal.does_asset_exist("/Game/Dragon/SK_Dragon"):
        for path in eal.list_assets("/Game/Dragon", recursive=True):
            if isinstance(eal.load_asset(path), unreal.SkeletalMesh):
                eal.rename_asset(path, "/Game/Dragon/SK_Dragon")
                break
    unreal.log("dragon imported: %s" % eal.does_asset_exist("/Game/Dragon/SK_Dragon"))


def new_material(name):
    path = "/Game/Materials/" + name
    if eal.does_asset_exist(path):
        eal.delete_asset(path)
    return tools.create_asset(name, "/Game/Materials", unreal.Material, unreal.MaterialFactoryNew())


def constant(mat, value, y):
    node = mel.create_material_expression(mat, unreal.MaterialExpressionConstant, -300, y)
    node.set_editor_property("r", value)
    return node


def finish(mat):
    mel.recompile_material(mat)
    eal.save_loaded_asset(mat)


def make_materials():
    m = new_material("M_Terrain")
    m.set_editor_property("two_sided", True)
    colour = mel.create_material_expression(m, unreal.MaterialExpressionVertexColor, -300, 0)
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(constant(m, 0.9, 200), "", unreal.MaterialProperty.MP_ROUGHNESS)
    finish(m)

    m = new_material("M_Glow")
    m.set_editor_property("two_sided", True)
    colour = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -600, 0)
    colour.set_editor_property("parameter_name", "Color")
    colour.set_editor_property("default_value", unreal.LinearColor(1.0, 0.65, 0.05, 1.0))
    bright = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -300, 100)
    mel.connect_material_expressions(colour, "", bright, "A")
    mel.connect_material_expressions(constant(m, 6.0, 300), "", bright, "B")
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(bright, "", unreal.MaterialProperty.MP_EMISSIVE_COLOR)
    finish(m)

    m = new_material("M_Water")
    colour = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -300, 0)
    colour.set_editor_property("parameter_name", "Color")
    colour.set_editor_property("default_value", unreal.LinearColor(0.01, 0.09, 0.16, 1.0))
    mel.connect_material_property(colour, "", unreal.MaterialProperty.MP_BASE_COLOR)
    mel.connect_material_property(constant(m, 0.08, 200), "", unreal.MaterialProperty.MP_ROUGHNESS)
    mel.connect_material_property(constant(m, 0.6, 300), "", unreal.MaterialProperty.MP_SPECULAR)
    finish(m)


import_dragon()
make_materials()
eal.save_directory("/Game")
unreal.log("DragonRider assets ready")
