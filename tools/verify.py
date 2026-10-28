from pathlib import Path
import hashlib
import json
import sys

root = Path(__file__).resolve().parent.parent / 'site'
manifest_path = root / 'public-manifest.json'
expected_manifest = '7d1a2b5d3c26a30c56ab0aa689a5967ef50d5e3d9e15d9fed88f4e75361a6a49'
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
if digest(manifest_path) != expected_manifest:
    raise SystemExit('Manifest differs from reviewed candidate')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
if manifest['base_path'] != '/competition-radar-site/' or manifest['release_id'] != 'g1514-4f8fc0389867fb7e1f070ae1':
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

if sys.argv[1:] not in ([], ['--publish']):
    raise SystemExit('Unknown argument')

print(f"PASS {manifest['release_id']}: {len(files)} files match reviewed manifest")
