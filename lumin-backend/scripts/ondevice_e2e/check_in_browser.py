"""Checks the app's on-device fingerprinting end to end, in a real browser, against this server's matcher.

Builds a small library of synthetic videos, records them again as WebM (like a screen recording), fingerprints each
recording with lumin-app/lib/fingerprint inside headless Chromium, and asks scan_fp.identify what it is. Prints one
line per recording and exits non-zero on any mismatch. Synthetic videos only prove the pipeline; they say nothing about
accuracy on real footage.

    cd lumin-backend
    NODE_PATH=<folder with esbuild + playwright> python scripts/ondevice_e2e/check_in_browser.py /tmp/ondevice-e2e
"""
import sys, types
pt=types.ModuleType('pytest'); pt.fixture=lambda *a,**k:(lambda f:f); pt.mark=types.SimpleNamespace(parametrize=lambda *a,**k:(lambda f:f)); sys.modules['pytest']=pt
import json, subprocess, pathlib, types, importlib.util, numpy as np
HERE = __import__('pathlib').Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
from app import scan_fp
spec = importlib.util.spec_from_file_location('tsm', str(ROOT / 'tests' / 'test_scan_matcher.py')); tsm = importlib.util.module_from_spec(spec); spec.loader.exec_module(tsm)
work = pathlib.Path(sys.argv[1]); work.mkdir(exist_ok=True)
paths = {}
for seed, silent in ((11, False), (22, False), (33, True)):
    p = work / f'v{seed}.mp4'
    if not p.exists(): tsm._video(p, seed, work, silent)
    paths[seed] = p
stranger = work / 'v99.mp4'
if not stranger.exists(): tsm._video(stranger, 99, work)
ix = scan_fp.build_index((s, scan_fp.extract_video(p)) for s, p in paths.items())
def rec(src, name, vf, start=1.0, dur=4):
    out = work / name
    subprocess.run(['ffmpeg','-y','-loglevel','error','-ss',str(start),'-t',str(dur),'-i',str(src),'-vf',vf,'-c:v','libvpx','-b:v','600k','-c:a','libopus','-b:a','48k',str(out)], check=True)
    return name
cases = {
 rec(paths[11],'r11.webm','scale=288:512,fps=30'): 11,
 rec(paths[22],'r22.webm','scale=288:512,fps=30'): 22,
 rec(paths[33],'r33.webm','scale=288:512,fps=30'): 33,
 rec(paths[22],'r22m.webm','hflip,scale=288:512'): 22,
 rec(paths[11],'r11long.webm','scale=216:384', start=0.0, dur=6): 11,
 'MR:r11long.webm': 11,
 rec(stranger,'r99.webm','scale=288:512,fps=30'): None,
}
subprocess.run(['node',str(HERE/'browser_fp.cjs'),str(work)]+list(cases), check=True)
fps = json.load(open(work/'fps.json'))
bad = 0
for name, want in cases.items():
    w = fps[name]
    if 'error' in w: print(name,'BROWSER ERROR',w['error']); bad+=1; continue
    q = scan_fp.query_from_wire(w)
    res = scan_fp.identify(ix, q)
    pyf = work/name if not name.startswith('MR:') else work/name[3:]
    py = scan_fp.identify(ix, scan_fp.extract_query(pyf))
    # feature parity vs python on the same file
    pq = scan_fp.extract_query(pyf)
    n = min(len(q.times), len(pq.times))
    d = np.unpackbits(q.hashes[False][:n] ^ pq.hashes[False][:n]).reshape(n,-1).sum(1)
    ah = set(map(int,q.audio[0])); ph = set(map(int,pq.audio[0]))
    ov = len(ah & ph)/max(1,len(ph))
    ok = res['id'] == want
    print(f"{name:14s} want={want} browser->{res['id']} ({res['stage']}) python-full->{py['id']} | frames {len(q.times)} vs {len(pq.times)} | median phash bits differ {np.median(d):.0f} | audio hash overlap {ov:.0%} | {'OK' if ok else 'MISMATCH'}")
    bad += (not ok)
print('FAILURES', bad)
sys.exit(1 if bad else 0)
