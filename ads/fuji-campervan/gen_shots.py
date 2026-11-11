"""Queue the ad shots on a local ComfyUI (Animagine XL 4.0) and wait for them.

    python gen_shots.py [seed] [shot names...]

The stills in shots/ came from seed 1107, except s3_lake (2207) and s4_night (3307).
Images land in ComfyUI/output/fujiad/.
"""
import json, sys, time, urllib.request

URL = "http://127.0.0.1:8188"
Q = "masterpiece, high score, great score, absurdres, no humans, scenery, landscape, detailed background, anime screencap, cinematic lighting, "
NEG = ("lowres, worst quality, low quality, low score, bad score, average score, text, signature, watermark, "
       "username, logo, blurry, jpeg artifacts, 1girl, 1boy, people, person, deformed vehicle, extra wheels, border, letterboxed")

SHOTS = {
    "s1_dawn": "mount fuji, snow-capped mountain, sunrise, dawn, red and pink sky, calm lake, reflection in water, morning mist, fog over water, pine trees, soft light, wide shot",
    "s2_road": "white camper van, motorhome driving on a road, from behind, straight country road leading to mount fuji, snow-capped mountain, blue sky, white clouds, green meadow, pampas grass, sunny day, wide shot",
    "s3_lake": "(white camper van:1.3), large motorhome parked on grass in foreground, vehicle focus, awning attached to van, open side door, camping chairs, small wooden table, coffee mug, kettle, mount fuji in background, snow-capped mountain, lake, clear blue sky, grass, afternoon sunlight, wide shot",
    "s4_night": "(white camper van:1.3) in foreground with warm glowing windows, vehicle focus, night, starry sky, milky way, mount fuji silhouette, snow-capped mountain, green grass, campfire, string lights, lakeside, reflection, dark blue tones, warm orange light, wide shot",
    "s5_sunset": "mount fuji, snow-capped mountain, sunset, golden hour, orange and purple sky, dramatic clouds, lake, small camper van silhouette on shore, vast sky, wide shot, negative space",
}
SEED = int(sys.argv[1]) if len(sys.argv) > 1 else 1107
ONLY = sys.argv[2:]


def graph(prompt, seed, prefix):
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "animagine-xl-4.0-opt.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": Q + prompt}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": NEG}},
        "4": {"class_type": "EmptyLatentImage", "inputs": {"width": 1344, "height": 768, "batch_size": 1}},
        "5": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
              "latent_image": ["4", 0], "seed": seed, "steps": 28, "cfg": 5.0,
              "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["5", 0], "vae": ["1", 2]}},
        "7": {"class_type": "SaveImage", "inputs": {"images": ["6", 0], "filename_prefix": prefix}},
    }


def post(path, data):
    req = urllib.request.Request(URL + path, json.dumps(data).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req))


ids = {}
for i, (name, p) in enumerate(SHOTS.items()):
    if ONLY and name not in ONLY:
        continue
    ids[name] = post("/prompt", {"prompt": graph(p, SEED + i, f"fujiad/{name}_{SEED}")})["prompt_id"]
    print("queued", name, ids[name], flush=True)

pending = dict(ids)
while pending:
    time.sleep(5)
    for name, pid in list(pending.items()):
        h = json.load(urllib.request.urlopen(f"{URL}/history/{pid}"))
        if pid in h:
            st = h[pid]["status"]
            print(name, st["status_str"], [o for n in h[pid]["outputs"].values() for o in n.get("images", [])], flush=True)
            del pending[name]
print("done")
