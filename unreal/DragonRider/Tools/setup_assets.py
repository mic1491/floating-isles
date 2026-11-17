"""Creates the project's assets inside the Unreal editor. Run it through Tools/rebuild_assets.sh,
which first removes the old Content/Rider and Content/Materials: the script builds them from
nothing, and emptying an existing material from Python crashes the 5.8 editor.

Makes  /Game/Textures/*            from SourceArt/tex/*.png
       /Game/Audio/*               from SourceArt/audio/*.wav (the _loop ones set to repeat)
       /Game/Rider/SM_Rider        the rider, from SourceArt/rider.fbx
       /Game/Materials/M_Terrain   vertex colours broken up by world-space detail
       /Game/Materials/M_Glow      glowing, with a "Color" parameter (rings, lanterns)
       /Game/Materials/M_Water     rippling sea, with a "Color" parameter
       /Game/Materials/M_Fire      additive flame puff for the fire breath
       /Game/Materials/M_Prop      trees and houses, which char and glow as they burn
       /Game/Materials/M_Hidden    draws nothing; hides the leaves of a burnt tree
       /Game/Materials/M_Smoke     a soft puff of smoke
       /Game/Materials/M_Scorch    burnt ground, a decal

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
    for name in ("noise_d", "noise_n", "macro_d", "water_n", "scorch_d"):
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
    for name in ("noise_d", "macro_d", "scorch_d"):
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
    # Embers glow in patches and cracks, not across a whole surface: the glow is cut by a fine
    # noise laid over the world, raised to a high power so only its peaks light up.
    # The noise is three-dimensional, so it breaks up walls as well as it does the ground.
    pos = node(m, unreal.MaterialExpressionWorldPosition, -1300, 800)
    grain = node(m, unreal.MaterialExpressionNoise, -1050, 800, scale=0.012, levels=3, output_min=0.0, output_max=1.0, turbulence=True)
    mel.connect_material_expressions(pos, "", grain, "Position")
    cracks = node(m, unreal.MaterialExpressionPower, -800, 800, const_exponent=10.0)
    mel.connect_material_expressions(grain, "", cracks, "Base")
    patchy = times(m, times(m, ember, glow, 650), cracks, 700)
    mel.connect_material_property(times(m, patchy, 45.0, 750), "", MP.MP_EMISSIVE_COLOR)
    mel.connect_material_property(const(m, 0.85, 900), "", MP.MP_ROUGHNESS)
    finish(m)


def make_smoke():
    """A soft puff of smoke. Each puff passes in how opaque it is now, how much fire-light is on it, and its age."""
    m = new_material("M_Smoke")
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    m.set_editor_property("shading_model", unreal.MaterialShadingModel.MSM_UNLIT)
    m.set_editor_property("used_with_instanced_static_meshes", True)
    alpha = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1300, 0, data_index=0, const_default_value=1.0)
    heat = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1300, 150, data_index=1, const_default_value=0.0)
    age = node(m, unreal.MaterialExpressionPerInstanceCustomData, -1300, 300, data_index=2, const_default_value=0.5)
    # Thick and dark where it boils up from the fire, thinning to a pale grey as it rises.
    young = node(m, unreal.MaterialExpressionConstant3Vector, -1100, 450, constant=unreal.LinearColor(0.05, 0.045, 0.04, 1.0))
    old = node(m, unreal.MaterialExpressionConstant3Vector, -1100, 600, constant=unreal.LinearColor(0.42, 0.40, 0.38, 1.0))
    shade = node(m, unreal.MaterialExpressionLinearInterpolate, -850, 500)
    mel.connect_material_expressions(young, "", shade, "A")
    mel.connect_material_expressions(old, "", shade, "B")
    mel.connect_material_expressions(age, "", shade, "Alpha")
    ember = node(m, unreal.MaterialExpressionConstant3Vector, -1100, 750, constant=unreal.LinearColor(1.4, 0.38, 0.08, 1.0))
    lit = node(m, unreal.MaterialExpressionAdd, -450, 550)
    mel.connect_material_expressions(shade, "", lit, "A")
    mel.connect_material_expressions(times(m, ember, heat, 700), "", lit, "B")
    mel.connect_material_property(lit, "", MP.MP_EMISSIVE_COLOR)
    # Dense in the middle of the puff and fading to nothing at its rim, so puffs blend into one plume.
    rim = node(m, unreal.MaterialExpressionFresnel, -1300, 900, exponent=1.0, base_reflect_fraction=0.0)
    core = node(m, unreal.MaterialExpressionOneMinus, -1100, 900)
    mel.connect_material_expressions(rim, "", core, "")
    soft = times(m, core, core, 900)
    mel.connect_material_property(times(m, times(m, soft, alpha, 950), 0.7, 1000), "", MP.MP_OPACITY)
    finish(m)


def make_scorch():
    """Burnt ground, projected down onto the terrain beneath whatever burned."""
    m = new_material("M_Scorch")
    m.set_editor_property("material_domain", unreal.MaterialDomain.MD_DEFERRED_DECAL)
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_TRANSLUCENT)
    tex = sample(m, "scorch_d", tiled_uv(m, 1.0, 0), 0)
    mel.connect_material_property(times(m, tex, 0.5, 0), "", MP.MP_BASE_COLOR)
    # The patch's alpha, strengthened so its middle covers the grass completely.
    cover = node(m, unreal.MaterialExpressionSaturate, -250, 200)
    strong = node(m, unreal.MaterialExpressionMultiply, -400, 200, const_b=1.8)
    mel.connect_material_expressions(tex, "A", strong, "A")
    mel.connect_material_expressions(strong, "", cover, "")
    mel.connect_material_property(cover, "", MP.MP_OPACITY)
    mel.connect_material_property(const(m, 1.0, 400), "", MP.MP_ROUGHNESS)
    mel.connect_material_property(const(m, 0.0, 500), "", MP.MP_SPECULAR)  # charcoal has no shine
    finish(m)


def make_hidden():
    """Draws nothing at all. Put on the leafy parts of a tree model to leave just its trunk and branches."""
    m = new_material("M_Hidden")
    m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
    m.set_editor_property("used_with_instanced_static_meshes", True)
    mel.connect_material_property(const(m, 0.0, 0), "", MP.MP_OPACITY_MASK)
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


def import_audio():
    names = [f[:-4] for f in sorted(os.listdir(os.path.join(ART, "audio"))) if f.endswith(".wav")]
    tasks = []
    for name in names:
        t = unreal.AssetImportTask()
        t.filename = os.path.join(ART, "audio", name + ".wav")
        t.destination_path = "/Game/Audio"
        t.automated = True
        t.replace_existing = True
        t.save = True
        tasks.append(t)
    tools.import_asset_tasks(tasks)
    for name in names:
        if name.endswith("_loop"):
            wave = eal.load_asset("/Game/Audio/" + name)
            wave.set_editor_property("looping", True)
            eal.save_loaded_asset(wave, only_if_is_dirty=False)


def prepare_packs():
    """Makes the game's own materials for the tree models of the Open World Demo Collection.

    The pack's materials are built on the old SpeedTree node, which in 5.8 draws nothing for the
    close-up levels of detail when a tree is drawn thousands at a time. So for each of them a plain
    replacement is made from the same textures: /Game/Materials/Trees/M_<original name>, which the
    game puts on the trees. Bark is solid; anything leafy is cut out by its texture's alpha and
    seen from both sides. It does nothing when the pack is not in the project."""
    hill = "/Game/KiteDemo/Environments/Trees/HillTree_02/"
    pine = "/Game/KiteDemo/Environments/Trees/ScotsPine_01/"
    if not eal.does_asset_exist(pine + "ScotsPine_01"):
        return
    # original material: (colour texture, normal map, cut out by alpha)
    table = {
        "HillTree_01_Branches_Mat":    (hill + "T_Craghead_Oak_Tile_01_D_Tex", hill + "T_Craghead_Oak_Tile_01_N_Tex", False),
        "HillTree_01_Branches_2_Mat":  (hill + "T_Craghead_Oak_LimbTile_02_D_Tex", hill + "T_Craghead_Oak_LimbTile_02_N_Tex", False),
        "HillTree_01_Fronds_Mat":      (hill + "HillTree_01_Atlas_Tex", hill + "HillTree_01_Atlas_Normal_Tex", True),
        "HillTree_01_Leaves_Mat":      (hill + "HillTree_01_Atlas_Tex", hill + "HillTree_01_Atlas_Normal_Tex", True),
        "HillTree_01_Leaves_Mat2":     (hill + "HillTree_01_Atlas_Tex", hill + "HillTree_01_Atlas_Normal_Tex", True),
        "ScotsPine_01_Branches_Mat":   (pine + "T_ScotsPine_Bark_01_Tex", pine + "T_ScotsPine_Bark_01_N_Tex", False),
        "ScotsPine_01_Branches_2_Mat": (pine + "T_ScotsPine_Bark_03_D_Tex", pine + "T_ScotsPine_Bark_03_N", False),
        "ScotsPine_01_Leaves_Mat":     (pine + "ScotsPine_01_Atlas_Tex", pine + "ScotsPine_01_Atlas_Normal_Tex", True),
        "ScotsPine_01_Fronds_Mat":     (pine + "ScotsPine_01_Atlas_Tex", pine + "ScotsPine_01_Atlas_Normal_Tex", True),
    }
    for name, (colour_path, normal_path, leafy) in table.items():
        colour, normal = eal.load_asset(colour_path), eal.load_asset(normal_path)
        m = tools.create_asset("M_" + name, "/Game/Materials/Trees", unreal.Material, unreal.MaterialFactoryNew())
        m.set_editor_property("used_with_instanced_static_meshes", True)
        m.set_editor_property("two_sided", leafy)
        if leafy:
            m.set_editor_property("blend_mode", unreal.BlendMode.BLEND_MASKED)
        c = node(m, unreal.MaterialExpressionTextureSample, -500, 0, texture=colour,
                 sampler_type=(unreal.MaterialSamplerType.SAMPLERTYPE_COLOR if colour.get_editor_property("srgb")
                               else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR))
        mel.connect_material_property(c, "RGB", MP.MP_BASE_COLOR)
        if leafy:
            mel.connect_material_property(c, "A", MP.MP_OPACITY_MASK)
        if normal and normal.get_editor_property("compression_settings") == unreal.TextureCompressionSettings.TC_NORMALMAP:
            nrm = node(m, unreal.MaterialExpressionTextureSample, -500, 300, texture=normal,
                       sampler_type=unreal.MaterialSamplerType.SAMPLERTYPE_NORMAL)
            mel.connect_material_property(nrm, "RGB", MP.MP_NORMAL)
        mel.connect_material_property(const(m, 0.8, 600), "", MP.MP_ROUGHNESS)
        finish(m)


def prepare_ground():
    """Lets the Open World Demo Collection's rock and plant materials be drawn in batches, which the
    game does with thousands of them. Done once in the local copy of the pack; nothing without it."""
    meshes = [
        "Rocks/LargePlainsBoulder002/SM_LargePlainsBoulder002", "Rocks/Large_Volcanic_Rock_001/LargeVolcanicRock_001",
        "Rocks/Large_Volcanic_Rock_001/LargeVolcanicRock_003", "Rocks/Mountain_RockFace_002/SM_MountainRock_Closed",
        "Rocks/Medium_Boulder_001/Medium_Boulder_001", "Rocks/Scree002/SM_Scree002_NEW", "Rocks/Scree001/Scree_001",
        "Rocks/River_Rock_01/SM_River_Rock_01", "Rocks/Boulder_05a/SM_Boulder05a", "Rocks/Medium_Boulder_002/Medium_Boulder_LowPoly",
        "Foliage/Grass/FieldGrass/SM_FieldGrass_01", "Foliage/Flowers/Heather/SM_Heather_Mesh_Clumps2", "Foliage/Ferns/SM_Fern_01",
        "Foliage/Flowers/Buttercup/SM_Buttercup_Patch_01", "Foliage/BogMyrtleBush_02/BogMyrtleBush_02"]
    done = set()
    for name in meshes:
        path = "/Game/KiteDemo/Environments/" + name
        if not eal.does_asset_exist(path):
            continue
        for slot in eal.load_asset(path).static_materials:
            base = slot.material_interface.get_base_material() if slot.material_interface else None
            if base and base.get_path_name() not in done:
                done.add(base.get_path_name())
                if not base.get_editor_property("used_with_instanced_static_meshes"):
                    base.set_editor_property("used_with_instanced_static_meshes", True)
                    mel.recompile_material(base)
                    eal.save_loaded_asset(base, only_if_is_dirty=False)
    unreal.log("ground materials prepared: %d" % len(done))


def prepare_village():
    """Works out how the Faymere River Village pack builds a house, so the game can build its own.

    The pack has no whole house: its level stands each one up from wall, corner, gable and door
    pieces on a stone base, with two tilted planes for a roof. This reads that level, picks one
    house of each of its two timber styles and writes the pieces and where they go to
    Content/FaymereVillage/houses.txt, which the game reads. It also lets those pieces' materials
    be drawn in batches. It does nothing when the pack is not in the project, or was done before."""
    level = "/Game/FaymereVillage/Maps/L_FaymereVillage"
    target = os.path.join(PROJECT, "Content", "FaymereVillage", "houses.txt")
    if not eal.does_asset_exist(level) or os.path.exists(target):
        return
    unreal.EditorLoadingAndSavingUtils.load_map(level)
    pieces = []
    for actor in unreal.get_editor_subsystem(unreal.EditorActorSubsystem).get_all_level_actors():
        for comp in actor.get_components_by_class(unreal.StaticMeshComponent):
            if comp.static_mesh:
                t = comp.get_world_transform()
                r = t.rotation.rotator()
                pieces.append({"mesh": comp.static_mesh, "name": comp.static_mesh.get_name(), "mats": comp.get_materials(),
                               "loc": (t.translation.x, t.translation.y, t.translation.z),
                               "rot": (r.pitch, r.yaw, r.roll), "scale": (t.scale3d.x, t.scale3d.y, t.scale3d.z)})
    frame = [p for p in pieces if "Medieval_Modular" in p["name"]]
    # Timber pieces within 4.5 m of each other belong to the same house.
    parent = list(range(len(frame)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(frame)):
        for j in range(i + 1, len(frame)):
            dx, dy = frame[i]["loc"][0] - frame[j]["loc"][0], frame[i]["loc"][1] - frame[j]["loc"][1]
            if dx * dx + dy * dy < 450 * 450:
                parent[find(i)] = find(j)
    groups = {}
    for i, p in enumerate(frame):
        groups.setdefault(find(i), []).append(p)

    lines, used = [], set()
    for style in ("uebmdapdw", "uewibaydw"):  # the main wall piece of each timber style
        # The smallest two-storey house of the style: enough pieces for two floors, few enough to stay cheap.
        mine = sorted((g for g in groups.values() if any(style in p["name"] for p in g) and 30 <= len(g) <= 45), key=len)
        if not mine:
            continue
        house = mine[0]
        xs, ys, zs = [p["loc"][0] for p in house], [p["loc"][1] for p in house], [p["loc"][2] for p in house]
        box = (min(xs) - 250, max(xs) + 250, min(ys) - 250, max(ys) + 250, min(zs) - 700, max(zs) + 900)
        extra = [p for p in pieces if p not in house and p["name"] in ("SM_Wall", "SM_400x400")
                 and box[0] <= p["loc"][0] <= box[1] and box[2] <= p["loc"][1] <= box[3] and box[4] <= p["loc"][2] <= box[5]]
        every = house + extra
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        z0 = min(p["loc"][2] for p in every)
        lines.append("H %s %d" % (style, len(every)))
        for p in every:
            mat = p["mats"][0] if p["name"] == "SM_400x400" and p["mats"] and p["mats"][0] else None  # the roof's tiles
            lines.append("P %s %s %.1f %.1f %.1f %.2f %.2f %.2f %.3f %.3f %.3f" % (
                p["mesh"].get_path_name(), mat.get_path_name() if mat else "-",
                p["loc"][0] - cx, p["loc"][1] - cy, p["loc"][2] - z0, *p["rot"], *p["scale"]))
            for m in p["mats"]:
                base = m.get_base_material() if m else None
                if base and base.get_path_name() not in used:
                    used.add(base.get_path_name())
                    if not base.get_editor_property("used_with_instanced_static_meshes"):
                        base.set_editor_property("used_with_instanced_static_meshes", True)
                        mel.recompile_material(base)
                        eal.save_loaded_asset(base, only_if_is_dirty=False)
    with open(target, "w") as f:
        f.write("\n".join(lines) + "\n")
    unreal.log("village layout written: %d lines" % len(lines))


import_textures()
import_audio()
prepare_packs()
prepare_ground()
make_terrain()
make_glow()
make_water()
make_fire()
make_prop()
make_hidden()
make_smoke()
make_scorch()
import_rider()
eal.save_directory("/Game/Materials")
eal.save_directory("/Game/Rider")
prepare_village()  # last: it opens the pack's level
unreal.log("DragonRider assets ready")
