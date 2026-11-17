"""Generates the seamless textures the game's materials use.

Run:  Blender --background --python build_textures.py -- <output folder>

  noise_d  / noise_n    fine organic grain, for the ground
  macro_d               broad patches, to vary the ground over long distances
  water_n               soft ripples, for the sea
  scorch_d              a patch of burnt ground with ash, alpha giving its ragged shape
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


def save_rgba(name, rgb, alpha):
    """Like save, with an alpha channel."""
    img = bpy.data.images.new(name, N, N, alpha=True)
    rgba = np.concatenate([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)[:, :, None]], axis=2).astype(np.float32)
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


n = tile_noise(60, 0.9, 500, min_freq=9)
save("noise_d", grey(n))
save("noise_n", normal_map(n, 0.03))

save("macro_d", grey(tile_noise(14, 1.3, 300, min_freq=2)))

# Scorched ground: a ragged black patch, streaked with grey ash, its edge broken up so that
# overlapping patches merge into one burnt area instead of showing as circles.
cy, cx = np.mgrid[0:N, 0:N] / N - 0.5
r = np.hypot(cx, cy) * 2.0
edge = 0.72 + 0.42 * (tile_noise(9, 1.2, 200, min_freq=2) - 0.5)
mask = np.clip((edge - r) / 0.28, 0, 1) ** 1.4 * (0.75 + 0.25 * tile_noise(30, 1.0, 300, min_freq=6))
ash = tile_noise(48, 0.9, 400, min_freq=8)
save_rgba("scorch_d", grey(0.015 + 0.10 * ash ** 2.5), mask)

w = tile_noise(10, 1.1, 120)
save("water_n", normal_map(w, 0.012))
print("textures written to", OUT)
