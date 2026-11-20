"""Makes the dragon's roars from public-domain recordings of a tyrannosaur and a bear.

Run:  Blender --background --python build_roar.py -- <SourceArt/audio folder>
(Blender is used only because its Python comes with numpy.)

Sources, in SourceArt/audio/sources/, all marked Public Domain on soundbible.com:
  trex_roar_twice.wav  "Tyrannosaurus Rex"        https://soundbible.com/1782-Tyrannosaurus-Rex-.html
  trex_roar.wav        "Tyrannosaurus Rex Roar"   https://soundbible.com/1748-Tyrannosaurus-Rex-Roar.html
  bear_growl_roar.wav  "Bear Growl And Roar 2"    https://soundbible.com/242-Bear-Growl-And-Roar-2.html (US Fish & Wildlife Service)

Writes roar.wav (the dragon's roar) and roar_hurt.wav (its cry when badly hurt).
"""
import os
import sys
import wave
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
AUDIO = argv[0] if argv else "."
SRC = os.path.join(AUDIO, "sources")
SR = 44100
rng = np.random.default_rng(5)


def load(name):
    with wave.open(os.path.join(SRC, name)) as w:
        sr, ch = w.getframerate(), w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64).reshape(-1, ch).mean(axis=1) / 32768
    if sr != SR:
        x = np.interp(np.arange(0, len(x), sr / SR), np.arange(len(x)), x)
    return x


def cut(x, start, end, fade=0.05):
    y = x[int(start * SR):int(end * SR)].copy()
    f = int(fade * SR)
    y[:f] *= np.linspace(0, 1, f)
    y[-f:] *= np.linspace(1, 0, f)
    return y


def pitch(x, factor):
    """Lower (factor < 1) or raise the pitch by playing it slower or faster, as a bigger or smaller throat would."""
    return np.interp(np.arange(0, len(x) - 1, factor), np.arange(len(x)), x)


def norm(x, peak=1.0):
    return x / max(np.abs(x).max(), 1e-9) * peak


def mix(*layers):
    out = np.zeros(max(len(l) for l, _, _ in layers) + int(max(o for _, _, o in layers) * SR))
    for x, gain, offset in layers:
        at = int(offset * SR)
        out[at:at + len(x)] += x * gain
    return out


def lowpass(x, cutoff):
    spec = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(spec / (1 + (f / cutoff) ** 4), len(x))


def space(x, seconds=0.9, wet=0.18):
    """A little room around it: the sound of it rolling off rock."""
    ir = rng.standard_normal(int(seconds * SR)) * np.exp(-np.linspace(0, 7, int(seconds * SR)))
    tail = np.fft.irfft(np.fft.rfft(x, len(x) + len(ir)) * np.fft.rfft(ir, len(x) + len(ir)))
    tail = lowpass(tail, 2500)
    return np.concatenate([x, np.zeros(len(ir))]) + wet * norm(tail, np.abs(x).max())


def rumble(seconds, env_from):
    """A deep chest rumble following the roar's own loudness, for the weight of a huge body."""
    t = np.arange(int(seconds * SR)) / SR
    freq = np.interp(t, [0, seconds], [52, 34])
    tone = np.sin(2 * np.pi * np.cumsum(freq) / SR) + 0.4 * np.sin(4 * np.pi * np.cumsum(freq) / SR)
    step = int(0.02 * SR)
    loud = np.array([np.sqrt(np.mean(env_from[i:i + step] ** 2)) for i in range(0, len(env_from), step)])
    env = np.interp(np.arange(len(t)), np.arange(len(loud)) * step, loud)[:len(t)]
    return tone * norm(env)


def save(name, x):
    x = np.tanh(norm(x, 1.15)) * 0.9  # a touch of saturation, then a safe level
    with wave.open(os.path.join(AUDIO, name + ".wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())
    print(f"{name}: {len(x) / SR:.1f}s")


trex2 = load("trex_roar_twice.wav")
trex = load("trex_roar.wav")
bear = load("bear_growl_roar.wav")

# The roar: the tyrannosaur's second, longer roar, slowed to a bigger throat, with the bear's gravel under it.
main = norm(pitch(cut(trex2, 1.25, 3.4), 0.82))
gravel = norm(pitch(cut(bear, 1.6, 3.1), 0.7))
body = rumble(len(main) / SR, main)
save("roar", space(mix((main, 1.0, 0.0), (gravel, 0.35, 0.05), (body, 0.45, 0.0))))

# Hurt: a shorter, higher, harsher cry breaking into the bear's snarl.
cry = norm(pitch(cut(trex, 0.25, 1.85), 1.12))
snarl = norm(pitch(cut(bear, 7.0, 8.2), 0.85))
save("roar_hurt", space(mix((cry, 1.0, 0.0), (snarl, 0.4, 0.9)), 0.6, 0.12))
