from pathlib import Path
from html.parser import HTMLParser
import hashlib
import json
import re
import subprocess
import sys

root = Path(__file__).resolve().parent.parent / 'site'
manifest_path = root / 'public-manifest.json'
expected_manifest = '76fb99babfe963f932f7745996ca6dea9428708b122aa55807c9c4bef2686eeb'
expected_temporal_gate = '0b21f0408fdca7f868bb5715f7fcb4d0bd70097438fb482155047c34c0a6aa3b'
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
if digest(manifest_path) != expected_manifest:
    raise SystemExit('Manifest differs from reviewed candidate')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
if manifest['base_path'] != '/competition-radar-site/' or manifest['release_id'] != 'g1514-68113e0f651647877c9fceb0':
    raise SystemExit('Release identity or path mismatch')
paths = list(root.rglob('*'))
if any(p.is_symlink() for p in paths):
    raise SystemExit('Symlinks are forbidden')
files = {p.relative_to(root).as_posix() for p in paths if p.is_file()}
if files != set(manifest['files']) | {'public-manifest.json'}:
    raise SystemExit('Unexpected or missing site files')
for relative, expected in manifest['files'].items():
    p = root / relative
    if p.stat().st_nlink != 1 or digest(p) != expected:
        raise SystemExit(f'Invalid file: {relative}')

class InitialStatusChecker(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ignored = []
        self.stale = False

    def handle_starttag(self, tag, attrs):
        if tag in {'script', 'style', 'option'}:
            self.ignored.append(tag)

    def handle_endtag(self, tag):
        if self.ignored and tag == self.ignored[-1]:
            self.ignored.pop()

    def handle_data(self, data):
        if not self.ignored and re.search(r'PUBLISHED_OPEN|报名中的赛项|当前公布窗口内|(?<!确认)(?<!证明)(?<!核实)报名当前开放|当前显示报名中', data):
            self.stale = True

for page in root.rglob('*.html'):
    checker = InitialStatusChecker()
    checker.feed(page.read_text(encoding='utf-8'))
    if checker.stale:
        raise SystemExit(f'Frozen open status in initial HTML: {page.relative_to(root)}')

if sys.argv[1:] not in ([], ['--publish']):
    raise SystemExit('Unknown argument')
if sys.argv[1:] == ['--publish'] and manifest.get('cache_compatibility') != 'PRESERVED':
    raise SystemExit('Previous public base differs; this artifact is preview only')

gate = root.parent / 'tools/verify_temporal.js'
if gate.is_symlink() or not gate.is_file() or digest(gate) != expected_temporal_gate:
    raise SystemExit('Temporal regression gate differs from reviewed version')
subprocess.run(['node', str(gate), str(root)], check=True)
print(f"PASS {manifest['release_id']}: {len(files)} files match reviewed manifest")
