"""Creates the project's assets inside the Unreal editor. Run it through Tools/rebuild_assets.sh,
which first removes the old Content/Rider and Content/Materials: the script builds them from
nothing, and emptying an existing material from Python crashes the 5.8 editor.

Makes  /Game/Textures/*            from SourceArt/tex/*.png
       /Game/Rider/SM_Rider        the rider, from SourceArt/rider.fbx
       /Game/Materials/M_Terrain   vertex colours broken up by world-space detail
       /Game/Materials/M_Glow      glowing, with a "Color" parameter (rings, lanterns)
       /Game/Materials/M_Water     rippling sea, with a "Color" parameter
       /Game/Materials/M_Fire      additive flame puff for the fire breath
       /Game/Materials/M_Prop      trees and houses, which char and glow as they burn

The dragon itself is not made here: it is the Sakura Dragon asset from Fab, in Content/SakuraDragon.
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
    for name in ("noise_d", "noise_n", "macro_d", "water_n"):
        t = unreal.AssetImportTask()
        t.filename = os.path.join(ART, "tex", name + ".png")
        t.destination_path = "/Game/Textures"
        t.automated = True
        t.replace_existing = True
        t.save = True
        tasks.append(t)
    tools.import_asset_tasks(tasks)
    for name in ("noise_n", "water_n"):
        tex = eal.load_asset("/Game/Textures/" + name)
        tex.set_editor_property("compression_settings", unreal.TextureCompressionSettings.TC_NORMALMAP)
        tex.set_editor_property("srgb", False)
        eal.save_loaded_asset(tex)
    for name in ("noise_d", "macro_d"):
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


def make_fire():
    """Glowing, see-through flame puff. Each puff passes in its heat: 1 when fresh, 0 when burnt out."""
    m = tools.create_asset("M_Fire", "/Game/Materials", unreal.Material, unreal.MaterialFactoryNew())
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    m.set_editor_property("used_with_instanced_static_meshes", True)
    heat = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1100, 0, data_index=0, const_default_value=1.0)
    ember = node(m, unreal.MaterialExpressionConstant3Vector, -1100, 150, constant=unreal.LinearColor(1.0, 0.06, 0.0, 1.0))
    flame = node(m, unreal.MaterialExpressionConstant3Vector, -1100, 300, constant=unreal.LinearColor(1.0, 0.62, 0.18, 1.0))
    colour = node(m, unreal.MaterialExpressionLinearInterpolate, -850, 150)
    mel.connect_material_expressions(ember, "", colour, "A")
    mel.connect_material_expressions(flame, "", colour, "B")
    mel.connect_material_expressions(heat, "", colour, "Alpha")
    # Bright in the middle of each puff and fading to nothing at its rim, so puffs merge softly.
    rim = node(m, unreal.MaterialExpressionFresnel, -1100, 450, exponent=1.2, base_reflect_fraction=0.0)
    core = node(m, unreal.MaterialExpressionOneMinus, -900, 450)
    mel.connect_material_expressions(rim, "", core, "")
    soft = times(m, core, core, 450)
    glow = times(m, times(m, times(m, colour, soft, 200), heat, 250), 2.2, 300)
    mel.connect_material_property(glow, "", MP.MP_EMISSIVE_COLOR)
    mel.connect_material_property(times(m, soft, heat, 550), "", MP.MP_OPACITY)
    finish(m)


def make_prop():
    """Trees and houses. Each one passes in how charred it is, how brightly it glows, and a shade."""
    m = new_material("M_Prop")
    m.set_editor_property("used_with_instanced_static_meshes", True)
    colour = node(m, unreal.MaterialExpressionVectorParameter, -1100, 0, parameter_name="Color",
                  default_value=unreal.LinearColor(0.05, 0.2, 0.05, 1.0))
    char = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1100, 200, data_index=0, const_default_value=0.0)
    glow = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1100, 350, data_index=1, const_default_value=0.0)
    shade = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1100, 500, data_index=2, const_default_value=0.5)
    varied = times(m, colour, remap(m, shade, 0.65, 0.7, 500), 0)        # each one a little lighter or darker
    soot = node(m, unreal.MaterialExpressionConstant3Vector, -900, 150, constant=unreal.LinearColor(0.012, 0.011, 0.01, 1.0))
    base = node(m, unreal.MaterialExpressionLinearInterpolate, -200, 0)
    mel.connect_material_expressions(varied, "", base, "A")
    mel.connect_material_expressions(soot, "", base, "B")
    mel.connect_material_expressions(char, "", base, "Alpha")
    ember = node(m, unreal.MaterialExpressionConstant3Vector, -900, 650, constant=unreal.LinearColor(1.0, 0.22, 0.02, 1.0))
    mel.connect_material_property(base, "", MP.MP_BASE_COLOR)
    mel.connect_material_property(times(m, times(m, ember, glow, 650), 5.0, 700), "", MP.MP_EMISSIVE_COLOR)
    mel.connect_material_property(const(m, 0.85, 900), "", MP.MP_ROUGHNESS)
    finish(m)


# ---- rider -----------------------------------------------------------------
def plain(name, colour, rough):
    m = new_material(name)
    c = node(m, unreal.MaterialExpressionConstant3Vector, -450, 0, constant=unreal.LinearColor(*colour, 1.0))
    mel.connect_material_property(c, "", MP.MP_BASE_COLOR)
    mel.connect_material_property(const(m, rough, 200), "", MP.MP_ROUGHNESS)
    return finish(m)


def import_rider():
    opts = unreal.FbxImportUI()
    opts.import_mesh = True
    opts.import_as_skeletal = False
    opts.import_animations = False
    opts.import_materials = False
    opts.import_textures = False
    opts.mesh_type_to_import = unreal.FBXImportType.FBXIT_STATIC_MESH
    task = unreal.AssetImportTask()
    task.filename = os.path.join(ART, "rider.fbx")
    task.destination_path = "/Game/Rider"
    task.destination_name = "SM_Rider"
    task.automated = True
    task.replace_existing = True
    task.save = True
    task.options = opts
    tools.import_asset_tasks([task])
    if not eal.does_asset_exist("/Game/Rider/SM_Rider"):
        for path in eal.list_assets("/Game/Rider", recursive=True):
            if isinstance(eal.load_asset(path), unreal.StaticMesh):
                eal.rename_asset(path, "/Game/Rider/SM_Rider")
                break
    mesh = eal.load_asset("/Game/Rider/SM_Rider")
    looks = {"Cloak": plain("M_RiderCloak", (0.05, 0.12, 0.35), 0.7), "Skin": plain("M_RiderSkin", (0.62, 0.42, 0.30), 0.6)}
    # Iterating the array gives copies, so the changed slots are gathered and written back whole.
    slots = []
    for slot in mesh.get_editor_property("static_materials"):
        for key, mat in looks.items():
            if key in str(slot.get_editor_property("material_slot_name")):
                slot.set_editor_property("material_interface", mat)
        slots.append(slot)
    mesh.set_editor_property("static_materials", slots)
    eal.save_loaded_asset(mesh, only_if_is_dirty=False)


import_textures()
make_terrain()
make_glow()
make_water()
make_fire()
make_prop()
import_rider()
eal.save_directory("/Game/Materials")
eal.save_directory("/Game/Rider")
unreal.log("DragonRider assets ready")
