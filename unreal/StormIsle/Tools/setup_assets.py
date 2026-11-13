"""Creates the project's own assets inside the Unreal editor. Run it through Tools/rebuild_assets.sh,
which first removes the old Content/Materials and Content/Textures: the script builds them from
nothing, and emptying an existing material from Python crashes the 5.8 editor.

Makes  /Game/Textures/*            from SourceArt/tex/*.png
       /Game/Materials/M_Terrain   vertex colours broken up by world-space detail
       /Game/Materials/M_Water     rippling sea, with a "Color" parameter
       /Game/Materials/M_Glow      glowing, with a "Color" parameter (crystals, beacon, lightning)
       /Game/Materials/M_Prop      trees, rocks, bushes and buildings: "Color", per-instance shade and hit flash
       /Game/Materials/M_Ghost     see-through preview of a piece being placed, "Color"
       /Game/Materials/M_Storm     the storm wall: see-through, swirling purple, "Color"
       /Game/Materials/M_Fire      additive flickering flame, "Color"
       /Game/Materials/M_Wraith    the storm creatures: dark bodies with glowing rims

The characters are Epic's mannequins, copied from the engine by Tools/get_mannequin.sh.
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


def colour_param(mat, default, y):
    return node(mat, unreal.MaterialExpressionVectorParameter, -1100, y, parameter_name="Color",
                default_value=unreal.LinearColor(*default, 1.0))


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


def plus(mat, a, b, y):
    n = node(mat, unreal.MaterialExpressionAdd, -350, y)
    mel.connect_material_expressions(a, "", n, "A")
    if isinstance(b, (int, float)):
        n.set_editor_property("const_b", float(b))
    else:
        mel.connect_material_expressions(b, "", n, "B")
    return n


def remap(mat, a, add, scale, y):
    """a * scale + add: turns a 0..1 texture into a gentle brightness variation around 1."""
    return plus(mat, times(mat, a, scale, y), add, y)


def lerp(mat, a, b, alpha, y):
    n = node(mat, unreal.MaterialExpressionLinearInterpolate, -200, y)
    mel.connect_material_expressions(a, "", n, "A")
    mel.connect_material_expressions(b, "", n, "B")
    mel.connect_material_expressions(alpha, "", n, "Alpha")
    return n


def rgb(mat, c, y):
    return node(mat, unreal.MaterialExpressionConstant3Vector, -900, y, constant=unreal.LinearColor(*c, 1.0))


def red(mat, a, y):
    """The first channel of a texture sample."""
    n = node(mat, unreal.MaterialExpressionComponentMask, -500, y, r=True, g=False, b=False, a=False)
    mel.connect_material_expressions(a, "", n, "")
    return n


def world_uv(mat, size, y, axes="xy"):
    """Texture coordinates laid over the world, repeating every `size` cm."""
    pos = node(mat, unreal.MaterialExpressionWorldPosition, -1400, y)
    mask = node(mat, unreal.MaterialExpressionComponentMask, -1200, y,
                r="x" in axes, g="y" in axes, b="z" in axes, a=False)
    mel.connect_material_expressions(pos, "", mask, "")
    div = node(mat, unreal.MaterialExpressionDivide, -1050, y, const_b=float(size))
    mel.connect_material_expressions(mask, "", div, "A")
    return div


def panned(mat, uv, sx, sy, y):
    pan = node(mat, unreal.MaterialExpressionPanner, -900, y, speed_x=sx, speed_y=sy)
    mel.connect_material_expressions(uv, "", pan, "Coordinate")
    return pan


def fresnel(mat, exponent, y):
    return node(mat, unreal.MaterialExpressionFresnel, -900, y, exponent=exponent, base_reflect_fraction=0.0)


def finish(mat):
    mel.recompile_material(mat)
    eal.save_loaded_asset(mat)
    return mat


# ---- materials --------------------------------------------------------------
def make_terrain():
    m = new_material("M_Terrain", two_sided=True)
    colour = node(m, unreal.MaterialExpressionVertexColor, -700, -300)
    near = world_uv(m, 1400, 0)
    grain = remap(m, sample(m, "noise_d", near, 0), 0.82, 0.36, 0)
    patch = remap(m, sample(m, "macro_d", world_uv(m, 9000, 250), 250), 0.55, 0.9, 250)
    region = remap(m, sample(m, "macro_d", world_uv(m, 60000, 400), 400), 0.65, 0.7, 400)
    detail = times(m, times(m, grain, patch, 100), region, 200)
    mel.connect_material_property(times(m, colour, detail, -150), "", MP.MP_BASE_COLOR)
    # Only a hint of the bumps, so the ground does not look like crumpled paper up close.
    flat = rgb(m, (0.0, 0.0, 1.0), 600)
    mel.connect_material_property(lerp(m, flat, sample(m, "noise_n", near, 500), const(m, 0.35, 650), 550), "", MP.MP_NORMAL)
    mel.connect_material_property(const(m, 0.92, 700), "", MP.MP_ROUGHNESS)
    finish(m)


def make_water():
    m = new_material("M_Water")
    mel.connect_material_property(colour_param(m, (0.01, 0.09, 0.16), -250), "", MP.MP_BASE_COLOR)
    layers = []
    for i, (size, sx, sy) in enumerate(((2400, 0.012, 0.005), (900, -0.015, 0.009))):
        layers.append(sample(m, "water_n", panned(m, world_uv(m, size, i * 250), sx, sy, i * 250), i * 250))
    mel.connect_material_property(plus(m, layers[0], layers[1], 100), "", MP.MP_NORMAL)
    mel.connect_material_property(const(m, 0.06, 500), "", MP.MP_ROUGHNESS)
    finish(m)


def make_glow():
    m = new_material("M_Glow", two_sided=True)
    m.set_editor_property("used_with_instanced_static_meshes", True)
    colour = colour_param(m, (0.6, 0.3, 1.0), 0)
    mel.connect_material_property(colour, "", MP.MP_BASE_COLOR)
    mel.connect_material_property(times(m, colour, 3.0, 150), "", MP.MP_EMISSIVE_COLOR)
    finish(m)


def make_prop():
    """Everything solid that is placed many times. Per instance: 0 = shade, 1 = how brightly it flashes when hit."""
    m = new_material("M_Prop")
    m.set_editor_property("used_with_instanced_static_meshes", True)
    colour = colour_param(m, (0.05, 0.2, 0.05), 0)
    shade = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1100, 200, data_index=0, const_default_value=0.5)
    flash = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1100, 350, data_index=1, const_default_value=0.0)
    grain = remap(m, red(m, sample(m, "noise_d", world_uv(m, 300, 450, "xz"), 450), 450), 0.75, 0.5, 450)
    varied = times(m, times(m, colour, remap(m, shade, 0.65, 0.7, 200), 0), grain, 100)
    mel.connect_material_property(varied, "", MP.MP_BASE_COLOR)
    mel.connect_material_property(times(m, rgb(m, (1.0, 0.85, 0.6), 650), flash, 650), "", MP.MP_EMISSIVE_COLOR)
    mel.connect_material_property(const(m, 0.85, 900), "", MP.MP_ROUGHNESS)
    finish(m)


def make_ghost():
    m = new_material("M_Ghost", two_sided=True)
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    colour = colour_param(m, (0.2, 1.0, 0.4), 0)
    mel.connect_material_property(times(m, colour, 1.5, 0), "", MP.MP_EMISSIVE_COLOR)
    mel.connect_material_property(plus(m, times(m, fresnel(m, 2.0, 300), 0.5, 300), 0.22, 300), "", MP.MP_OPACITY)
    finish(m)


def make_storm():
    """A wall of swirling cloud seen from both sides: two layers of noise sliding up and around it."""
    m = new_material("M_Storm", two_sided=True)
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    colour = colour_param(m, (0.45, 0.12, 0.9), 0)
    uv = node(m, unreal.MaterialExpressionTextureCoordinate, -1300, 300, u_tiling=24.0, v_tiling=3.0)
    a = red(m, sample(m, "macro_d", panned(m, uv, 0.02, -0.06, 300), 300), 300)
    uv2 = node(m, unreal.MaterialExpressionTextureCoordinate, -1300, 550, u_tiling=60.0, v_tiling=7.0)
    b = red(m, sample(m, "noise_d", panned(m, uv2, -0.05, -0.12, 550), 550), 550)
    swirl = times(m, a, b, 450)
    # Brighter streaks where the two layers meet, and the wall thins out toward its top.
    up = node(m, unreal.MaterialExpressionTextureCoordinate, -1300, 800)
    v = node(m, unreal.MaterialExpressionComponentMask, -1100, 800, r=False, g=True, b=False, a=False)
    mel.connect_material_expressions(up, "", v, "")
    fade = times(m, v, v, 800)
    glow = times(m, colour, remap(m, swirl, 0.4, 3.5, 150), 150)
    mel.connect_material_property(glow, "", MP.MP_EMISSIVE_COLOR)
    opacity = node(m, unreal.MaterialExpressionClamp, -150, 600)
    mel.connect_material_expressions(times(m, plus(m, times(m, swirl, 1.8, 600), 0.3, 600), fade, 650), "", opacity, "")
    mel.connect_material_property(opacity, "", MP.MP_OPACITY)
    finish(m)


def make_fire():
    m = new_material("M_Fire", two_sided=True)
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_ADDITIVE)
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    colour = colour_param(m, (1.0, 0.45, 0.08), 0)
    uv = node(m, unreal.MaterialExpressionTextureCoordinate, -1300, 300, u_tiling=2.0, v_tiling=1.0)
    flicker = red(m, sample(m, "noise_d", panned(m, uv, 0.03, -0.9, 300), 300), 300)
    core = node(m, unreal.MaterialExpressionOneMinus, -900, 500)
    mel.connect_material_expressions(fresnel(m, 1.5, 500), "", core, "")
    mel.connect_material_property(times(m, times(m, colour, flicker, 200), times(m, core, 6.0, 500), 250), "", MP.MP_EMISSIVE_COLOR)
    finish(m)


def make_wraith():
    m = new_material("M_Wraith")
    m.set_editor_property("used_with_skeletal_mesh", True)
    colour = colour_param(m, (0.55, 0.15, 1.0), 0)
    mel.connect_material_property(rgb(m, (0.02, 0.015, 0.03), -200), "", MP.MP_BASE_COLOR)
    pulse = remap(m, red(m, sample(m, "noise_d", panned(m, world_uv(m, 150, 300, "xz"), 0.0, -0.3, 300), 300), 300), 0.3, 1.4, 300)
    rim = times(m, fresnel(m, 2.5, 150), pulse, 150)
    mel.connect_material_property(times(m, times(m, colour, rim, 100), 6.0, 100), "", MP.MP_EMISSIVE_COLOR)
    mel.connect_material_property(const(m, 0.4, 600), "", MP.MP_ROUGHNESS)
    finish(m)


import_textures()
make_terrain()
make_water()
make_glow()
make_prop()
make_ghost()
make_storm()
make_fire()
make_wraith()
unreal.log("StormIsle assets ready")
