"""Something made from its words: drawn by an image model, then raised into a 3D mesh it can stand in its place.

Optional, and outside the zero-dependency server: it needs its own Python with PyTorch (CUDA), and three local models.
Its server (server/maker.js) runs it between cycles, when the graphics card is free:

    python scripts/make.py --describe "a copper bell with a crack in its lip" --out data/made/<id>.bin

1. FLUX.2 klein (through stable-diffusion.cpp's sd-cli) draws the thing alone on a plain background, from its words.
2. rembg cuts it out of the picture.
3. TripoSR raises the picture into a mesh, coloured at its corners, which is made smaller to travel to the page.
4. The mesh is written in the format the page reads ("LYM1", the same as the models it borrows; see scripts/models.js),
   with the picture beside it (<out>.png).

Where everything is (environment variables, with defaults for one Windows machine):
  LYPE_SD_CLI        sd-cli.exe                           C:\\AI\\stable-diffusion.cpp\\sd-cli.exe
  LYPE_IMAGE_MODELS  folder with flux-2-klein-4b-Q8_0.gguf, Qwen3-4B-Q4_K_M.gguf and flux2-vae.safetensors   C:\\AI\\models
  LYPE_TRIPOSR_CODE  a checkout of github.com/VAST-AI-Research/TripoSR             C:\\AI\\image3d\\TripoSR
  LYPE_TRIPOSR       folder with TripoSR's config.yaml and model.ckpt              C:\\AI\\models\\TripoSR

Prints one line of JSON: {"ok": true, "dims": [w, h, d], "faces": n} or {"ok": false, "error": "..."}.
"""

import argparse
import json
import os
import struct
import subprocess
import sys
import tempfile

SD = os.environ.get("LYPE_SD_CLI", r"C:\AI\stable-diffusion.cpp\sd-cli.exe")
IMAGE_MODELS = os.environ.get("LYPE_IMAGE_MODELS", r"C:\AI\models")
TRIPOSR_CODE = os.environ.get("LYPE_TRIPOSR_CODE", r"C:\AI\image3d\TripoSR")
TRIPOSR = os.environ.get("LYPE_TRIPOSR", r"C:\AI\models\TripoSR")
FACES = 12000  # small enough to travel to a phone


def draw(describe, png, seed):
    """The thing alone, whole, on a plain background: what the next step needs to see its shape."""
    prompt = (
        f"a single {describe}, the whole object in view, centered, standing on nothing, "
        "plain white background, soft even studio light, 3D render, no text, no people"
    )
    m = lambda f: os.path.join(IMAGE_MODELS, f)
    cmd = [
        SD,
        "--diffusion-model", m("flux-2-klein-4b-Q8_0.gguf"),
        "--llm", m("Qwen3-4B-Q4_K_M.gguf"),
        "--vae", m("flux2-vae.safetensors"),
        "-p", prompt,
        "--steps", "4", "--cfg-scale", "1", "--sampling-method", "euler",
        "-W", "512", "-H", "512", "-s", str(seed),
        "--diffusion-fa", "-o", png,
    ]
    subprocess.run(cmd, check=True, capture_output=True, timeout=900)


def raise_mesh(png, resolution):
    sys.path.insert(0, TRIPOSR_CODE)
    import numpy as np
    import rembg
    import torch
    from PIL import Image
    from tsr.system import TSR
    from tsr.utils import remove_background, resize_foreground

    # u2net (Apache 2.0, ~170 MB): rembg's newer default is far larger and licensed for non-commercial use only
    image = remove_background(Image.open(png).convert("RGB"), rembg.new_session("u2net"))
    image = resize_foreground(image, 0.85)
    a = np.array(image).astype(np.float32) / 255.0
    a = a[:, :, :3] * a[:, :, 3:4] + (1 - a[:, :, 3:4]) * 0.5
    image = Image.fromarray((a * 255.0).astype(np.uint8))

    model = TSR.from_pretrained(TRIPOSR, config_name="config.yaml", weight_name="model.ckpt")
    model.renderer.set_chunk_size(8192)
    model.to("cuda")
    with torch.no_grad():
        codes = model([image], device="cuda")
    mesh = model.extract_mesh(codes, True, resolution=resolution)[0]
    del model
    torch.cuda.empty_cache()
    return mesh


def upright(mesh):
    """TripoSR's mesh stands with its up along z and faces along x; the place has up along y and fronts along z."""
    import numpy as np
    import trimesh

    turn = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])  # z up -> y up
    face = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])  # its front toward the viewer (+z)
    mesh.apply_transform(face @ turn)
    if mesh.volume < 0:  # inside out: turn its faces round so the light falls on the outside
        mesh.invert()
    return mesh


def smaller(mesh):
    """Fewer faces, keeping its shape and the colours at its corners (nearest of the old corners)."""
    import numpy as np

    if len(mesh.faces) <= FACES:
        return mesh
    import fast_simplification
    import trimesh
    from scipy.spatial import cKDTree

    verts, faces = fast_simplification.simplify(mesh.vertices, mesh.faces, 1 - FACES / len(mesh.faces))
    small = trimesh.Trimesh(verts, faces, process=False)
    near = cKDTree(mesh.vertices).query(small.vertices)[1]
    small.visual.vertex_colors = np.asarray(mesh.visual.vertex_colors)[near]
    return small


def pack(mesh, out):
    """ "LYM1", corners, indices, its real size; its corners in a unit box (uint16), facing (int8), colour (uint8)."""
    import numpy as np

    pos = np.asarray(mesh.vertices, dtype=np.float64)
    nor = np.asarray(mesh.vertex_normals, dtype=np.float64)
    col = np.asarray(mesh.visual.vertex_colors)[:, :3].astype(np.uint8)
    idx = np.asarray(mesh.faces, dtype=np.int64).reshape(-1)
    lo = pos.min(axis=0)
    dims = np.maximum(pos.max(axis=0) - lo, 1e-4)
    n = len(pos)
    wide = n > 65535
    q = np.round((pos - lo) / dims * 65535).astype("<u2")
    nn = np.zeros((n, 4), dtype=np.int8)
    nn[:, :3] = np.round(np.clip(nor, -1, 1) * 127).astype(np.int8)
    cc = np.zeros((n, 4), dtype=np.uint8)
    cc[:, :3] = col
    body = b"LYM1" + struct.pack("<II", n, len(idx)) + struct.pack("<fff", *dims) + q.tobytes() + nn.tobytes() + cc.tobytes()
    body += idx.astype("<u4" if wide else "<u2").tobytes()
    body += b"\0" * ((4 - len(body) % 4) % 4)
    with open(out, "wb") as f:
        f.write(body)
    return [round(float(v), 3) for v in dims]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--describe", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--resolution", type=int, default=192)
    args = ap.parse_args()
    try:
        png = os.path.splitext(args.out)[0] + ".png"
        os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
        draw(args.describe[:200], png, args.seed)
        mesh = smaller(upright(raise_mesh(png, args.resolution)))
        tmp = args.out + ".part"
        dims = pack(mesh, tmp)
        os.replace(tmp, args.out)
        print(json.dumps({"ok": True, "dims": dims, "faces": int(len(mesh.faces))}))
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-3:]
        print(json.dumps({"ok": False, "error": "drawing failed: " + " | ".join(tail)}))
        sys.exit(1)
    except Exception as e:  # noqa: BLE001 - the server is told what went wrong, whatever it was
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
