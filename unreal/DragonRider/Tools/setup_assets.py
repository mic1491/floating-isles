"""Creates the project's assets inside the Unreal editor. Run it through Tools/rebuild_assets.sh,
which first removes the old Content/Dragon and Content/Materials: the script builds them from
nothing, and emptying an existing material from Python crashes the 5.8 editor.

Makes  /Game/Textures/*            from SourceArt/tex/*.png
       /Game/Dragon/SK_Dragon      the dragon and rider, from SourceArt/dragon.fbx
       /Game/Materials/M_Dragon*   scaled hide, leathery wings, horn, rider
       /Game/Materials/M_Terrain   vertex colours broken up by world-space detail
       /Game/Materials/M_Glow      glowing, with a "Color" parameter (rings)
       /Game/Materials/M_Water     rippling sea, with a "Color" parameter
"""
import os
import unreal

PROJECT = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_dir())
ART = os.path.join(PROJECT, "SourceArt")
tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
MP = unreal.MaterialProperty


# ---- textures ---------------------------------------------------------------
def import_textures():
    tasks = []
    for name in ("scales_d", "scales_n", "noise_d", "noise_n", "macro_d", "water_n", "dragon_d"):
        t = unreal.AssetImportTask()
        t.filename = os.path.join(ART, "tex", name + ".png")
        t.destination_path = "/Game/Textures"
        t.automated = True
        t.replace_existing = True
        t.save = True
        tasks.append(t)
    tools.import_asset_tasks(tasks)
    for name in ("scales_n", "noise_n", "water_n"):
        tex = eal.load_asset("/Game/Textures/" + name)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property("srgb", False)
        eal.save_loaded_asset(tex)
    for name in ("scales_d", "noise_d", "macro_d"):
        tex = eal.load_asset("/Game/Textures/" + name)
        tex.set_editor_property("srgb", False)  # used as plain brightness, not colour
        eal.save_loaded_asset(tex)


# ---- material graph helpers -------------------------------------------------
def new_material(name, two_sided=False):
    mat = tools.create_asset(name, "/Game/Materials", unreal.Material, unreal.MaterialFactoryNew())
    mat.set_editor_property("two_sided", two_sided)
    return mat


def node(mat, cls, x, y, **props):
    n = mel.create_material_expression(mat, cls, x, y)
    for k, v in props.items():
        n.set_editor_property(k, v)
    return n


def const(mat, value, y):
    return node(mat, unreal.MaterialExpressionConstant, -250, y, r=value)


def sample(mat, name, uv, y):
    is_normal = name.endswith("_n")
    n = node(mat, unreal.MaterialExpressionTextureSample, -700, y,
             texture=eal.load_asset("/Game/Textures/" + name),
             sampler_type=(unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL if is_normal
                           else unreal.MaterialSamplerType.SAMPLERTYPE_COLOR if name == "dragon_d"
                           else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR))
    mel.connect_material_expressions(uv, "", n, "UVs")
    return n


def times(mat, a, b, y):
    """a * b, where b is another node or a plain number."""
    m = node(mat, unreal.MaterialExpressionMultiply, -450, y)
    mel.connect_material_expressions(a, "", m, "A")
    if isinstance(b, (int, float)):
        m.set_editor_property("const_b", float(b))
    else:
        mel.connect_material_expressions(b, "", m, "B")
    return m


def remap(mat, a, add, scale, y):
    """a * scale + add: turns a 0..1 texture into a gentle brightness variation around 1."""
    n = node(mat, unreal.MaterialExpressionAdd, -350, y, const_b=float(add))
    mel.connect_material_expressions(times(mat, a, scale, y), "", n, "A")
    return n


def tiled_uv(mat, tiling, y):
    return node(mat, unreal.MaterialExpressionTextureCoordinate, -950, y, u_tiling=tiling, v_tiling=tiling)


def world_uv(mat, size, y):
    """Texture coordinates laid flat over the world, repeating every `size` cm."""
    pos = node(mat, unreal.MaterialExpressionWorldPosition, -1400, y)
    xy = node(mat, unreal.MaterialExpressionComponentMask, -1200, y, r=True, g=True, b=False, a=False)
    mel.connect_material_expressions(pos, "", xy, "")
    div = node(mat, unreal.MaterialExpressionDivide, -1050, y, const_b=float(size))
    mel.connect_material_expressions(xy, "", div, "A")
    return div


def finish(mat):
    mel.recompile_material(mat)
    eal.save_loaded_asset(mat)
    return mat


# ---- materials --------------------------------------------------------------
def painted(name, detail=None, normal=None, tiling=1.0, gain=1.0, rough=0.6, metal=0.0, two_sided=False):
    """The dragon's baked colour texture, optionally multiplied by a tiling brightness texture,
    with a normal map."""
    m = new_material(name, two_sided)
    # Without this the game cannot use the material on the dragon and shows plain grey instead.
    m.set_editor_property("used_with_skeletal_mesh", True)
    colour = sample(m, "dragon_d", tiled_uv(m, 1.0, -300), -200)
    uv = tiled_uv(m, tiling, 100)
    base = colour
    if detail:
        base = times(m, times(m, colour, sample(m, detail, uv, 0), -100), gain, -100)
    mel.connect_material_property(base, "", MP.MP_BASE_COLOR)
    if normal:
        mel.connect_material_property(sample(m, normal, uv, 250), "", MP.MP_NORMAL)
    mel.connect_material_property(const(m, rough, 450), "", MP.MP_ROUGHNESS)
    mel.connect_material_property(const(m, metal, 550), "", MP.MP_METALLIC)
    return finish(m)


def make_terrain():
    m = new_material("M_Terrain", two_sided=True)
    colour = node(m, unreal.MaterialExpressionVertexColor, -700, -300)
    near = world_uv(m, 4000, 0)
    # Fine grain up close, and two sizes of broad patches so no repeat shows from the air.
    grain = remap(m, sample(m, "noise_d", near, 0), 0.6, 0.8, 0)
    patch = remap(m, sample(m, "macro_d", world_uv(m, 130000, 250), 250), 0.55, 0.9, 250)
    region = remap(m, sample(m, "macro_d", world_uv(m, 710000, 400), 400), 0.6, 0.8, 400)
    detail = times(m, times(m, grain, patch, 100), region, 200)
    mel.connect_material_property(times(m, colour, detail, -150), "", MP.MP_BASE_COLOR)
    mel.connect_material_property(sample(m, "noise_n", near, 500), "", MP.MP_NORMAL)
    mel.connect_material_property(const(m, 0.92, 700), "", MP.MP_ROUGHNESS)
    finish(m)


def make_glow():
    m = new_material("M_Glow", two_sided=True)
    colour = node(m, unreal.MaterialExpressionVectorParameter, -700, 0, parameter_name="Color",
                  default_value=unreal.LinearColor(1.0, 0.65, 0.05, 1.0))
    mel.connect_material_property(colour, "", MP.MP_BASE_COLOR)
    mel.connect_material_property(times(m, colour, 8.0, 150), "", MP.MP_EMISSIVE_COLOR)
    finish(m)


def make_water():
    m = new_material("M_Water")
    colour = node(m, unreal.MaterialExpressionVectorParameter, -700, -250, parameter_name="Color",
                  default_value=unreal.LinearColor(0.01, 0.09, 0.16, 1.0))
    mel.connect_material_property(colour, "", MP.MP_BASE_COLOR)
    # Two layers of ripples sliding across each other.
    layers = []
    for i, (size, sx, sy) in enumerate(((9000, 0.012, 0.005), (3100, -0.015, 0.009))):
        pan = node(m, unreal.MaterialExpressionPanner, -900, i * 250, speed_x=sx, speed_y=sy)
        mel.connect_material_expressions(world_uv(m, size, i * 250), "", pan, "Coordinate")
        layers.append(sample(m, "water_n", pan, i * 250))
    both = node(m, unreal.MaterialExpressionAdd, -450, 100)
    mel.connect_material_expressions(layers[0], "", both, "A")
    mel.connect_material_expressions(layers[1], "", both, "B")
    mel.connect_material_property(both, "", MP.MP_NORMAL)
    mel.connect_material_property(const(m, 0.06, 500), "", MP.MP_ROUGHNESS)
    finish(m)


# ---- dragon -----------------------------------------------------------------
def import_dragon(materials):
    if eal.does_directory_exist("/Game/Dragon"):
        eal.delete_directory("/Game/Dragon")
    opts = unreal.FbxImportUI()
    opts.import_mesh = True
    opts.import_as_skeletal = True
    opts.import_animations = False
    opts.import_materials = False
    opts.import_textures = False
    opts.mesh_type_to_import = unreal.FBXImportType.FBXIT_SKELETAL_MESH
    opts.skeletal_mesh_import_data.set_editor_property(
        "vertex_color_import_option", unreal.VertexColorImportOption.REPLACE)
    task = unreal.AssetImportTask()
    task.filename = os.path.join(ART, "dragon.fbx")
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
    mesh = eal.load_asset("/Game/Dragon/SK_Dragon")
    # Iterating the array gives copies, so the changed slots are gathered and written back whole.
    slots = []
    for slot in mesh.get_editor_property("materials"):
        name = str(slot.get_editor_property("material_slot_name"))
        for key, mat in materials.items():
            if key in name:
                slot.set_editor_property("material_interface", mat)
        slots.append(slot)
    mesh.set_editor_property("materials", slots)
    eal.save_loaded_asset(mesh, only_if_is_dirty=False)


import_textures()
make_terrain()
make_glow()
make_water()
import_dragon({
    "Body": painted("M_DragonBody", "scales_d", "scales_n", tiling=16.0, gain=1.3, rough=0.42, metal=0.3),
    "Wing": painted("M_DragonWing", "noise_d", "noise_n", tiling=5.0, gain=1.5, rough=0.7, two_sided=True),
    "Horn": painted("M_DragonHorn", "noise_d", tiling=4.0, gain=2.0, rough=0.35),
    "Rider": painted("M_Rider", rough=0.65),
})
eal.save_directory("/Game")
unreal.log("DragonRider assets ready")
