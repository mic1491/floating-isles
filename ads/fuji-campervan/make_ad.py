"""Build the 20-second Mt. Fuji campervan travel ad.

Takes the five stills in shots/, gives each a slow camera move, cross-fades
them, lays captions and an end card on top, synthesises a soft music bed and
encodes the whole thing to fuji-campervan-ad.mp4.

    python make_ad.py /path/to/ffmpeg

Needs Pillow and numpy; ffmpeg is passed in so no system install is required.
"""
import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).parent
FFMPEG = sys.argv[1] if len(sys.argv) > 1 else "ffmpeg"
OUT = HERE / "fuji-campervan-ad.mp4"
W, H, FPS, DUR = 1920, 1080, 30, 20.0
SHOT_LEN, FADE = 4.4, 0.5
STEP = (DUR - SHOT_LEN) / 4  # start-to-start spacing of the five shots

# file, caption, camera start (zoom, centre x, centre y), camera end
SHOTS = [
    ("s1_dawn.png", "清晨，被富士山叫醒", (1.00, 0.50, 0.50), (1.12, 0.50, 0.44)),
    ("s2_road.png", "把家，開進風景裡", (1.04, 0.50, 0.52), (1.24, 0.50, 0.46)),
    ("s3_lake.png", "湖畔，就是你的客廳", (1.16, 0.43, 0.52), (1.16, 0.57, 0.52)),
    ("s4_night.png", "星空下，與富士同眠", (1.20, 0.50, 0.40), (1.20, 0.50, 0.60)),
    ("s5_sunset.png", None, (1.16, 0.50, 0.50), (1.00, 0.50, 0.50)),
]
TITLE, TAGLINE, LATIN = "富士山下・露營車之旅", "現在，就出發", "MT. FUJI CAMPERVAN JOURNEY"


def font(path, want, size):
    """Pick the face whose style name contains `want` out of a .ttc collection."""
    for i in range(32):
        try:
            f = ImageFont.truetype(path, size, index=i)
        except OSError:
            break
        if all(w in " ".join(f.getname()) for w in want):
            return f
    return ImageFont.truetype(path, size, index=0)


def songti(size, weight="Bold"):
    return font("/System/Library/Fonts/Supplemental/Songti.ttc", ("Songti TC", weight), size)


def text_layer(text, f, xy, spacing, anchor="l"):
    """Full-frame RGBA layer: letter-spaced white text over a soft dark shadow."""
    widths = [f.getlength(c) for c in text]
    total = sum(widths) + spacing * (len(text) - 1)
    x = xy[0] - {"l": 0, "c": total / 2, "r": total}[anchor]
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    for c, w in zip(text, widths):
        if c == "・":  # Songti TC has no glyph for the middle dot, so draw one
            r, cy = f.size * 0.07, xy[1] + f.size * 0.62
            d.ellipse((x + w / 2 - r, cy - r, x + w / 2 + r, cy + r), fill=255)
        else:
            d.text((x, xy[1]), c, font=f, fill=255)
        x += w + spacing
    shadow = mask.filter(ImageFilter.GaussianBlur(14)).point(lambda v: min(255, int(v * 1.5)))
    layer = Image.merge("RGBA", [Image.new("L", (W, H), 0)] * 3 + [shadow])
    layer.paste(Image.new("RGBA", (W, H), (255, 252, 244, 255)), (0, 0), mask)
    return np.asarray(layer, dtype=np.float32) / 255.0


def over(frame, layer, opacity, dy=0):
    """Composite an RGBA float layer onto the frame, shifted down by dy pixels."""
    if opacity <= 0:
        return frame
    if dy:
        layer = np.roll(layer, int(round(dy)), axis=0)
    a = layer[..., 3:4] * opacity
    return frame * (1 - a) + layer[..., :3] * a


def smooth(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def camera(img, start, end, p):
    """Crop the still at the interpolated zoom/centre and scale it to the frame."""
    z, cx, cy = (a + (b - a) * p for a, b in zip(start, end))
    sw, sh = img.size
    cw = sw / z
    ch = cw * H / W
    if ch > sh:
        ch, cw = sh, sh * W / H
    x0 = min(max(cx * sw - cw / 2, 0), sw - cw)
    y0 = min(max(cy * sh - ch / 2, 0), sh - ch)
    out = img.resize((W, H), Image.Resampling.BICUBIC, box=(x0, y0, x0 + cw, y0 + ch))
    return np.asarray(out, dtype=np.float32) / 255.0


def music(path):
    """A calm 20-second bed: four held pad chords with a plucked arpeggio and echo."""
    sr = 44100
    n = int(DUR * sr)
    t = np.arange(n) / sr
    out = np.zeros((n, 2))
    note = lambda m: 440.0 * 2 ** ((m - 69) / 12)
    chords = [  # Cmaj9, Am9, Fmaj9, Gsus2 -> resolves back toward C
        [48, 55, 64, 71, 74],
        [45, 52, 60, 67, 71],
        [41, 48, 57, 64, 67],
        [43, 50, 57, 62, 69],
    ]
    bar = DUR / len(chords)
    eighth = bar / 16
    for ci, chord in enumerate(chords):
        t0 = ci * bar
        seg = (t >= t0 - 0.2) & (t < t0 + bar + 1.5)
        ts = t[seg] - t0
        env = np.clip((ts + 0.2) / 1.4, 0, 1) * np.clip((bar + 1.5 - ts) / 1.7, 0, 1)
        for k, m in enumerate(chord):
            f = note(m)
            for det, pan in ((-0.25, 0.3), (0.25, 0.7)):
                s = np.sin(2 * np.pi * (f + det) * ts) + 0.25 * np.sin(4 * np.pi * (f + det) * ts)
                amp = 0.05 * (1.4 if k == 0 else 1.0) * env
                out[seg, 0] += s * amp * (1 - pan)
                out[seg, 1] += s * amp * pan
        pattern = [1, 2, 3, 4, 3, 2, 3, 4, 1, 2, 3, 4, 3, 4, 2, 3]
        for i, k in enumerate(pattern):
            if ci == len(chords) - 1 and i >= 12:
                break  # let the last bar ring out
            start = int((t0 + i * eighth) * sr)
            length = min(int(1.6 * sr), n - start)
            tp = np.arange(length) / sr
            f = note(chord[k] + 12)
            s = (np.sin(2 * np.pi * f * tp) + 0.35 * np.sin(4 * np.pi * f * tp)) * np.exp(-tp * 3.2)
            s *= np.clip(tp / 0.004, 0, 1) * 0.11
            pan = 0.35 + 0.3 * (i % 2)
            out[start:start + length, 0] += s * (1 - pan)
            out[start:start + length, 1] += s * pan
    for delay, gain in ((0.31, 0.35), (0.62, 0.18), (0.93, 0.08)):  # echo tail
        d = int(delay * sr)
        out[d:] += out[:-d][:, ::-1] * gain
    out *= (np.clip(t / 0.4, 0, 1) * np.clip((DUR - t) / 1.8, 0, 1))[:, None]
    out *= 0.7 / np.abs(out).max()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((out * 32767).astype("<i2").tobytes())


def main():
    stills = [Image.open(HERE / "shots" / s[0]).convert("RGB") for s in SHOTS]

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r = np.hypot((xx - W / 2) / (W / 2), (yy - H / 2) / (H / 2))
    grade = (1 - 0.32 * np.clip(r - 0.55, 0, 1) ** 1.6)  # vignette
    grade *= 1 - 0.30 * np.clip((yy - H * 0.62) / (H * 0.38), 0, 1) ** 2  # darker foot for captions
    grade = grade[..., None]

    captions = [text_layer(s[1], songti(76), (150, 850), 14) if s[1] else None for s in SHOTS]
    captions[3] = text_layer(SHOTS[3][1], songti(76), (W - 150, 850), 14, "r")  # the van sits bottom-left here
    title = text_layer(TITLE, songti(118), (W / 2, 400), 16, "c")
    rule = np.zeros((H, W, 4), np.float32)
    rule[573:575, W // 2 - 60:W // 2 + 60] = (1, 0.99, 0.96, 0.9)
    tagline = text_layer(TAGLINE, songti(58, "Regular"), (W / 2, 606), 22, "c")
    latin = text_layer(LATIN, font("/System/Library/Fonts/Avenir Next.ttc", ("Demi Bold",), 30), (W / 2, 716), 10, "c")

    wav = HERE / "_music.wav"
    music(wav)
    enc = subprocess.Popen(
        [FFMPEG, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
         "-r", str(FPS), "-i", "-", "-i", str(wav), "-c:v", "libx264", "-preset", "slow", "-crf", "19",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", str(OUT)],
        stdin=subprocess.PIPE)

    for n in range(int(DUR * FPS)):
        t = n / FPS
        frame = np.zeros((H, W, 3), np.float32)
        for i, (_, _, a, b) in enumerate(SHOTS):
            local = t - i * STEP
            if not 0 <= local < SHOT_LEN:
                continue
            alpha = 1.0 if i == 0 else smooth(local / FADE)
            if alpha <= 0:
                continue
            img = camera(stills[i], a, b, local / SHOT_LEN)
            frame = img if alpha >= 1 else frame * (1 - alpha) + img * alpha
        frame = frame * grade

        for i, cap in enumerate(captions):
            if cap is None:
                continue
            local = t - i * STEP
            o = smooth((local - 0.7) / 0.6) * smooth((STEP - 0.05 - local) / 0.45)
            frame = over(frame, cap, o, dy=18 * (1 - smooth((local - 0.7) / 0.9)))

        end = t - 4 * STEP  # end card over the sunset
        if end > 0:
            frame = frame * (1 - 0.22 * smooth((end - 0.4) / 1.0))
            frame = over(frame, title, smooth((end - 0.7) / 0.8), dy=20 * (1 - smooth((end - 0.7) / 1.1)))
            frame = over(frame, rule, smooth((end - 1.4) / 0.6))
            frame = over(frame, tagline, smooth((end - 1.6) / 0.7))
            frame = over(frame, latin, smooth((end - 2.1) / 0.7) * 0.85)

        frame = frame * smooth(t / 0.5) * smooth((DUR - t) / 0.4)
        enc.stdin.write((np.clip(frame, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes())

    enc.stdin.close()
    if enc.wait():
        sys.exit("ffmpeg failed")
    wav.unlink()
    print("wrote", OUT)


if __name__ == "__main__":
    main()
