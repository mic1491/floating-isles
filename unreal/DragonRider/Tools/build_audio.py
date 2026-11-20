"""Synthesises every sound in the game, so none has to be downloaded or licensed.

Run:  Blender --background --python build_audio.py -- <output folder>
(Blender is used only because its Python comes with numpy.)

Loops (names ending _loop) are built to repeat without a click: their noise is made in the
frequency domain, which is periodic, and their notes wrap around the end.
"""
import os
import sys
import wave
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "."
os.makedirs(OUT, exist_ok=True)
SR = 44100
rng = np.random.default_rng(11)


def save(name, x, peak=0.89):
    x = np.asarray(x, dtype=np.float64)
    x = x / max(np.abs(x).max(), 1e-9) * peak
    with wave.open(os.path.join(OUT, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    print(f"{name}: {len(x) / SR:.1f}s")


def times(seconds):
    return np.arange(int(seconds * SR)) / SR


def noise(seconds, lo, hi, slope=1.0):
    """Looping noise between lo and hi Hz, falling off as 1/f^slope."""
    n = int(seconds * SR)
    f = np.fft.rfftfreq(n, 1 / SR)
    amp = np.where((f >= lo) & (f <= hi), 1.0 / np.maximum(f, 1.0) ** slope, 0.0)
    spec = amp * np.exp(1j * rng.uniform(0, 2 * np.pi, len(f)))
    x = np.fft.irfft(spec, n)
    return x / np.abs(x).max()


def wobble(seconds, rate, depth):
    """A slow looping wander around 1, for making steady noise breathe."""
    return 1.0 + depth * noise(seconds, 0.05, rate, 0.0)


def bump(t, centre, width):
    return np.exp(-0.5 * ((t - centre) / width) ** 2)


# ---- wind past the rider: steady rush with gusts ---------------------------
save("wind_loop", noise(6, 60, 1100, 1.3) * wobble(6, 1.2, 0.35) + 0.08 * noise(6, 1100, 2600, 1.6) * wobble(6, 3.0, 0.5))  # a low rush, with little hiss

# ---- wingbeats: a heavy downstroke and a lighter upstroke, 1.6 s like the flight animation
t = times(1.6)
down, up = bump(t, 0.38, 0.13), bump(t, 1.15, 0.11)
save("wings_loop", noise(1.6, 60, 500, 0.9) * (down + 0.45 * up) + 0.5 * noise(1.6, 400, 2600, 1.2) * (bump(t, 0.33, 0.09) + 0.4 * bump(t, 1.12, 0.08)))

# ---- fire breath: a roaring jet with a low rumble --------------------------
save("fire_loop", noise(3, 50, 3500, 0.75) * wobble(3, 18.0, 0.45) + 0.6 * noise(3, 30, 140, 0.3) * wobble(3, 6.0, 0.3))

# ---- things burning: softer flames with sharp crackles ---------------------
t = times(5)
crackle = np.zeros(len(t))
for _ in range(140):
    at = rng.integers(0, len(t) - 2000)
    length = rng.integers(150, 900)
    crackle[at:at + length] += rng.uniform(0.3, 1.0) * rng.standard_normal(length) * np.exp(-np.arange(length) / (length * 0.22))
save("burn_loop", 0.55 * noise(5, 80, 2500, 0.9) * wobble(5, 9.0, 0.4) + 0.5 * crackle)

# The roar is made from recordings, by Tools/build_roar.py.

# ---- ring passed: a bright bell --------------------------------------------
t = times(1.4)
save("ring", sum(a * np.sin(2 * np.pi * f * t) * np.exp(-t * d) for f, a, d in ((880, 1.0, 3.5), (1320, 0.6, 4.5), (1760, 0.45, 6.0), (2640, 0.25, 8.0))), 0.7)

# ---- something bursts into flame: a soft thump of air -----------------------
t = times(0.9)
save("ignite", np.sin(2 * np.pi * np.cumsum(np.interp(t, [0, 0.9], [75, 38])) / SR) * np.exp(-t * 5) + 0.7 * noise(0.9, 100, 1800, 1.0) * np.exp(-t * 6))

# ---- landing: weight hitting the ground -------------------------------------
t = times(0.7)
save("thud", np.sin(2 * np.pi * np.cumsum(np.interp(t, [0, 0.7], [70, 30])) / SR) * np.exp(-t * 7) + 0.4 * noise(0.7, 200, 2500, 1.0) * np.exp(-t * 18))

# ---- being hit: a sharp crack ----------------------------------------------
t = times(0.45)
save("hit", noise(0.45, 300, 5000, 0.6) * np.exp(-t * 22) + 0.6 * np.sin(2 * np.pi * 110 * t) * np.exp(-t * 12))

# ---- rain: a steady hiss with drops ticking through it ----------------------
t = times(8)
drops = np.zeros(len(t))
for _ in range(2600):
    at = rng.integers(0, len(t) - 400)
    length = rng.integers(60, 300)
    drops[at:at + length] += rng.uniform(0.1, 0.6) * rng.standard_normal(length) * np.exp(-np.arange(length) / (length * 0.15))
save("rain_loop", noise(8, 900, 9000, 0.6) * wobble(8, 0.8, 0.25) + 0.5 * noise(8, 150, 900, 1.0) * wobble(8, 0.5, 0.3) + 0.6 * drops)

# ---- thunder: a sharp crack that rolls away into a long low rumble ---------
t = times(6.0)
crack = noise(6.0, 500, 6000, 0.5) * np.exp(-t * 14) * (t < 0.6)
rumble = noise(6.0, 25, 260, 1.0) * np.interp(t, [0, 0.15, 1.2, 6.0], [0, 1.0, 0.75, 0.0]) * wobble(6.0, 3.0, 0.6)
save("thunder", np.tanh(1.6 * (0.8 * crack + rumble)))

# ---- music: slow minor chords under a high, lonely line ---------------------
LENGTH = 48.0
n = int(LENGTH * SR)
t = np.arange(n) / SR
music = np.zeros(n)


def hz(semitones_from_a4):
    return 440.0 * 2 ** (semitones_from_a4 / 12.0)


def add_note(freq, start, length, level, harmonics=7, vibrato=0.0):
    """A soft note that swells in and fades out; it wraps round the end of the loop."""
    dt = (t - start) % LENGTH
    env = np.clip(dt / (length * 0.35), 0, 1) * np.clip((length - dt) / (length * 0.45), 0, 1)
    env = np.where(dt < length, env, 0.0) ** 1.5
    wobble_ = 1 + vibrato * np.sin(2 * np.pi * 5.2 * t)
    tone = np.zeros(n)
    for detune in (-0.004, 0.0, 0.004):
        ph = 2 * np.pi * freq * (1 + detune) * t * wobble_
        for h in range(1, harmonics + 1):
            tone += np.sin(h * ph) / h ** 2
    music[:] += level * env * tone


# D minor, B flat, F, C: each held 12 s and overlapping the next
chords = [(-31, -24, -19, -16, -12), (-35, -28, -23, -19, -16), (-28, -21, -16, -12, -9), (-33, -26, -21, -17, -14)]
for i, chord in enumerate(chords):
    for k, note in enumerate(chord):
        add_note(hz(note), i * 12.0 - 1.0, 14.5, 0.5 if k == 0 else 0.3)
# the line above them: one long note every 6 s
for i, note in enumerate((5, 3, 0, -2, 5, 8, 7, 3)):
    add_note(hz(note), i * 6.0 + 1.0, 5.5, 0.16, harmonics=3, vibrato=0.004)
# a deep drum at the start of each chord and a softer one halfway
for i in range(8):
    dt = (t - i * 6.0) % LENGTH
    hit = np.sin(2 * np.pi * (58 * dt - 60 * dt ** 2 * (dt < 0.4))) * np.exp(-dt * 4.5)
    music += (0.9 if i % 2 == 0 else 0.45) * hit
save("music_loop", music, 0.8)
