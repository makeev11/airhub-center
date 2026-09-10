"""Reproduce the small close-button overlay for the pinned demo Hygge pilot.

Inputs are index.html and center-availability.js exported from the 900ffb2224d3
relay image (config ID 7c555c0db6f49ee7f927c89955dd959ea05164110bbfeec546804c9352a7f13a).
This changes the wrapper only; the iframe keeps using Center's /booking route.
"""

import hashlib
import json
from pathlib import Path
import re
import sys


def digest(data):
    return hashlib.sha256(data).hexdigest()


source, output = map(Path, sys.argv[1:3])
expected = {
    "center-availability.js": "5626dae0fc7636eab487581f64794b80ba4616891905b6f411b2ee01e21fbb4f",
    "index.html": "845c0d53ad47d98213a64cfb7782e7d96ca3fe53e3adee467b920a975ec10b5f",
}
for name, checksum in expected.items():
    assert digest((source / name).read_bytes()) == checksum, name
runtime = (source / "center-availability.js").read_text()
html = (source / "index.html").read_text()
old = 'close.textContent = "Закрыть запись ×";'
assert runtime.count(old) == 1
svg = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>'
runtime = runtime.replace(old, 'close.setAttribute("aria-label", "Закрыть запись");\n        close.innerHTML = ' + json.dumps(svg) + ';')
css = '.hygge-booking-dialog button{min-height:2.75rem;padding:.5rem;cursor:pointer;font:inherit}'
assert runtime.count(css) == 1
runtime = runtime.replace(css, '.hygge-booking-dialog button{width:44px;height:44px;flex:0 0 44px;display:inline-flex;align-items:center;justify-content:center;padding:10px;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;font:inherit}.hygge-booking-dialog button svg{width:24px;height:24px;flex:none}.hygge-booking-dialog button:hover{background:#5720380a}.hygge-booking-dialog button:focus-visible{outline:2px solid currentColor;outline-offset:2px}')
html, changed = re.subn(r'(center-availability\.js\?v=)[a-z0-9]+', lambda m: m[1] + digest(runtime.encode())[:16], html)
assert changed == 1
output.mkdir(parents=True, exist_ok=False)
(output / "center-availability.js").write_text(runtime)
(output / "index.html").write_text(html)
(output / "manifest.json").write_text(json.dumps({
    "inputs": expected,
    "files": [{"path": "airhop/hygge/" + name, "sha256": digest((output / name).read_bytes())} for name in expected],
}, indent=2) + "\n")
