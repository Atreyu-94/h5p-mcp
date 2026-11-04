"""Quality report for fixed SVG-derived and direct Typst PNGs at native resolution."""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from skimage.metrics import structural_similarity

root = Path(sys.argv[1])
pairs = []
report = {}
for case in ("motion", "reaction-energy", "water", "forces"):
    source_file = root / "paired" / f"{case}.typ.direct.png"
    derived_file = root / "paired" / f"{case}.typ.raster.png"
    if source_file.read_bytes() != (root / case / "reference.png").read_bytes():
        raise ValueError(f"{case}: measured control does not match the original")
    if derived_file.read_bytes() != (root / case / "candidate.png").read_bytes():
        raise ValueError(f"{case}: measured candidate differs from the independent raster")
    source = Image.open(source_file).convert("RGBA")
    derived = Image.open(derived_file).convert("RGBA")
    if source.size != derived.size:
        raise ValueError(f"{case}: dimensions differ {source.size}, {derived.size}")
    # Only compare untouched pixels; the white matte corresponds to these examples' page fills.
    def matte(im, color):
        bg = Image.new("RGBA", im.size, color)
        bg.alpha_composite(im)
        return bg.convert("RGB")

    a, b = matte(source, "white"), matte(derived, "white")
    left, right = np.asarray(a).astype(float), np.asarray(b).astype(float)
    diff = np.abs(left - right)
    ink = np.minimum(left.min(axis=2), right.min(axis=2)) < 240
    error = diff.max(axis=2)
    ssim = float(structural_similarity(left, right, data_range=255, channel_axis=2))
    black_diff = np.abs(np.asarray(matte(source, "black")).astype(float)
                        - np.asarray(matte(derived, "black")).astype(float))
    report[case] = {
        "pixels": list(source.size), "ssim_rgb_white": ssim,
        "rgb_mae_white": float(diff.mean()), "rgb_mae_black": float(black_diff.mean()),
        "ink_rgb_mae_white": float(diff[ink].mean()),
        "ink_max_channel_error_p95": float(np.percentile(error[ink], 95)),
        "percent_ink_error_over_32": float((error[ink] > 32).mean()*100),
        "percent_pixels_identical_rgba": float(np.all(np.asarray(source)==np.asarray(derived),axis=2).mean()*100),
        "alpha_mae": float(np.abs(np.asarray(source)[:,:,3].astype(float)-np.asarray(derived)[:,:,3].astype(float)).mean()),
    }
    # Difference intensity is intentionally amplified; never used to compute similarity.
    enhanced = Image.fromarray(np.uint8(255-np.minimum(error*5,255))).convert("RGB")
    pairs.append((case, a, b, enhanced))

width=max(a.width for _,a,_,_ in pairs)
height=sum(a.height+34 for _,a,_,_ in pairs)
sheet=Image.new("RGB",(3*(width+8),height),"white")
draw=ImageDraw.Draw(sheet)
y=0
for name,a,b,diff in pairs:
    for col,(title,img) in enumerate((("Typst PNG",a),("validated SVG -> resvg",b),("absolute difference x5",diff))):
        x=col*(width+8)
        draw.text((x+4,y),f"{name} | {title}",fill="black")
        sheet.paste(img,(x,y+20))
    y+=a.height+34
sheet.save(root/"quality-comparison.png")
(root/"quality.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
print(json.dumps(report))
