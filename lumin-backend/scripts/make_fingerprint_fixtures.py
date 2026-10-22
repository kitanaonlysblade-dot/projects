"""Regenerates lumin-app/tests/fixtures/fingerprint.json: inputs plus what THIS Python matcher (app/scan_fp.py)
computes for them. The app's TypeScript fingerprint code (lumin-app/lib/fingerprint) must reproduce these numbers;
tests/fingerprint.test.ts checks it. Run this again (and commit the result) whenever scan_fp.py's fingerprint maths
changes, then fix the TypeScript until that test passes.

    cd lumin-backend && python scripts/make_fingerprint_fixtures.py
"""
import base64
import json
import pathlib
import sys

import cv2
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app import scan_fp  # noqa: E402

OUT = ROOT.parent / "lumin-app" / "tests" / "fixtures" / "fingerprint.json"


def audio_case():
    rng = np.random.default_rng(7)
    sr, secs = scan_fp.SR, 3
    t = np.arange(sr * secs) / sr
    y = np.zeros_like(t)
    for _ in range(8):
        f0, f1, a = rng.uniform(200, 3000), rng.uniform(200, 3000), rng.uniform(0.05, 0.3)
        s, d = rng.uniform(0, secs - 1), rng.uniform(0.3, 1.0)
        m = (t >= s) & (t < s + d)
        y[m] += a * np.sin(2 * np.pi * (f0 + (f1 - f0) * (t[m] - s) / d) * (t[m] - s))
    y += rng.normal(0, 0.01, len(y))
    pcm = (np.clip(y, -1, 1) * 32767).astype(np.int16)
    h, tt = scan_fp.audio_hashes(pcm.astype(np.float32) / 32768)
    return {"pcm_b64": base64.b64encode(pcm.astype("<i2").tobytes()).decode(), "hash": h.tolist(), "t": tt.tolist()}


def image_cases():
    rng = np.random.default_rng(3)
    cases = []
    for k, (w, h) in enumerate([(90, 160), (90, 160), (160, 90), (92, 160), (101, 177)]):
        base = rng.integers(0, 255, (h // 8 + 1, w // 8 + 1)).astype(np.float32)
        g = cv2.resize(base, (w, h), interpolation=cv2.INTER_CUBIC) + rng.normal(0, 6, (h, w))
        xx, yy = np.meshgrid(np.arange(w), np.arange(h))
        g += 60 * np.sin(xx / 17.0 + k) * np.cos(yy / 23.0)
        g = np.clip(g, 0, 255).astype(np.uint8)
        if k == 1:
            g[:14, :] = 0  # black bars top and bottom
            g[-14:, :] = 0
        if k == 3:
            g[30:100, 20:60] = 128  # a flat region: some cells have no detail
        c, ok = scan_fp.cell_hashes(g)
        cases.append({"w": w, "h": h, "data_b64": base64.b64encode(g.tobytes()).decode(), "phash": scan_fp.phash(g).tolist(),
                      "cells": c.flatten().tolist(), "ok": ok.astype(int).tolist()})
    return cases


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump({"fp_version": scan_fp.FP_VERSION, "audio": audio_case(), "images": image_cases()}, open(OUT, "w"))
    print("wrote", OUT, OUT.stat().st_size, "bytes")
