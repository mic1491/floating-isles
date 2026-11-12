"""Generates the seamless textures the game's materials use.

Run:  Blender --background --python build_textures.py -- <output folder>

  scales_d / scales_n   dragon hide: overlapping scales (brightness and normal map)
  noise_d  / noise_n    fine organic grain, for ground and wing leather
  macro_d               broad patches, to vary the ground over long distances
  water_n               soft ripples, for the sea
"""
import os
import sys
import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "."
os.makedirs(OUT, exist_ok=True)
N = 512
rng = np.random.default_rng(7)
ys, xs = np.mgrid[0:N, 0:N] / N


def save(name, rgb):
    """rgb: N x N x 3 floats in 0..1"""
    img = bpy.data.images.new(name, N, N, alpha=False)
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.ones((N, N, 1))], axis=2).astype(np.float32)
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = os.path.join(OUT, name + ".png")
    img.file_format = "PNG"
    img.save()


def grey(h):
    return np.repeat(h[:, :, None], 3, axis=2)


def normal_map(h, strength):
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * N
    dy = (np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)) * 0.5 * N
    n = np.stack([-dx * strength, dy * strength, np.ones_like(h)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def unit(h):
    return (h - h.min()) / (h.max() - h.min())


def tile_noise(max_freq, falloff, count=260, min_freq=1):
    """Sum of waves with whole-number frequencies, so it repeats exactly at the edges.
    A min_freq well above 1 leaves out the broad waves that show up as stripes when tiled."""
    h = np.zeros((N, N))
    for _ in range(count):
        fx, fy = rng.integers(-max_freq, max_freq + 1, 2)
        f = np.hypot(fx, fy)
        if f < min_freq or f > max_freq:
            continue
        h += np.cos(2 * np.pi * (fx * xs + fy * ys) + rng.uniform(0, 2 * np.pi)) / f ** falloff
    return unit(h)


def scales(cells=14):
    """Jittered, row-staggered cell pattern: each cell is a domed scale with a dark seam."""
    pts = np.zeros((cells, cells, 2))
    for j in range(cells):
        for i in range(cells):
            pts[j, i] = ((i + 0.5 + (0.5 if j % 2 else 0) + rng.uniform(-0.18, 0.18)) / cells,
                         (j + 0.5 + rng.uniform(-0.18, 0.18)) / cells)
    ci = np.floor(xs * cells).astype(int)
    cj = np.floor(ys * cells).astype(int)
    f1 = np.full((N, N), 9.0)
    f2 = np.full((N, N), 9.0)
    for dj in (-1, 0, 1):
        for di in (-2, -1, 0, 1, 2):
            p = pts[(cj + dj) % cells, (ci + di) % cells]
            dx = np.abs(xs - p[..., 0]); dx = np.minimum(dx, 1 - dx)
            dy = np.abs(ys - p[..., 1]); dy = np.minimum(dy, 1 - dy)
            d = np.hypot(dx, dy * 1.25) * cells
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            f1 = np.where(closer, d, f1)
    seam = np.clip((f2 - f1) * 3.0, 0, 1)          # 0 in the gaps between scales
    dome = np.clip(1.0 - f1 * 0.9, 0, 1)
    return unit(seam * (0.55 + 0.45 * dome))


s = scales()
grain = tile_noise(48, 1.0)
save("scales_d", grey(np.clip(0.18 + 0.75 * s + 0.14 * (grain - 0.5), 0, 1)))
save("scales_n", normal_map(s, 0.035))

n = tile_noise(60, 0.9, 500, min_freq=9)
save("noise_d", grey(n))
save("noise_n", normal_map(n, 0.03))

save("macro_d", grey(tile_noise(14, 1.3, 300, min_freq=2)))

w = tile_noise(10, 1.1, 120)
save("water_n", normal_map(w, 0.012))
print("textures written to", OUT)
