"""Compare a product smoke run with the four direct Typst controls and raw resvg."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity

output, controls, smoke, tool_root = map(lambda arg: Path(arg).resolve(), sys.argv[1:])
base = "ubuntu@sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852"
report = {}
for case in ("motion", "reaction-energy", "water", "forces"):
    source = controls / case / "input"
    svg = (source / "figure.svg").read_bytes()
    figure = next(p.parent for p in smoke.glob("figure-*/figure.svg") if p.read_bytes() == svg)
    raw = output / f"{case}.raw.png"
    raw.write_bytes(subprocess.check_output([
        "docker", "run", "--rm", "--pull", "never", "--network", "none", "--read-only",
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", "65534:65534",
        "--memory", "256m", "--memory-swap", "256m", "--cpus", "1", "--pids-limit", "64",
        "--mount", f"type=bind,src={tool_root / 'tools'},dst=/tools,readonly",
        "--mount", f"type=bind,src={source},dst=/input,readonly", base, "/tools/resvg",
        "--dpi", "192", "--skip-system-fonts", "/input/figure.svg", "-c",
    ]))
    product, reference = figure / "figure.png", controls / case / "reference.png"
    a, b, c = [np.array(Image.open(p).convert("RGBA")) for p in (product, raw, reference)]
    assert np.array_equal(a, b), f"{case}: lossless compression changed pixels"
    dh, dw = a.shape[0]-c.shape[0], a.shape[1]-c.shape[1]
    assert dh in (0, 1) and dw in (0, 1), f"{case}: unexpected change in page geometry"
    # Composite on white before comparing. Extra boundary pixels must contain no ink.
    def white(pixels):
        alpha = pixels[:, :, 3:] / 255.0
        return pixels[:, :, :3] * alpha + 255 * (1-alpha)
    image = white(a)
    assert np.all(image[c.shape[0]:] >= 254) and np.all(image[:, c.shape[1]:] >= 254)
    overlap = image[:c.shape[0], :c.shape[1]]
    score = structural_similarity(overlap, white(c), data_range=255, channel_axis=2)
    report[case] = dict(rawBytes=raw.stat().st_size, productBytes=product.stat().st_size,
                        typstBytes=reference.stat().st_size, width=a.shape[1], height=a.shape[0],
                        extraColumns=dw, extraRows=dh, identicalRGBA=True, overlapSSIM=score,
                        sha256=hashlib.sha256(product.read_bytes()).hexdigest())
    print(case, report[case])
(output / "quality.json").write_text(json.dumps(report, indent=2) + "\n")
