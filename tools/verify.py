from pathlib import Path
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone

root = Path(__file__).resolve().parent.parent / 'site'
manifest_path = root / 'public-manifest.json'
expected_manifest = '67e167194d8ec604f9e217b07938227cdf54a4e344bf98bc2dbd5ec26f12651b'
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
if digest(manifest_path) != expected_manifest:
    raise SystemExit('Manifest differs from reviewed candidate')
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
if manifest['base_path'] != '/competition-radar-site/' or manifest['release_id'] != 'g1514-208b6883554c5025de85a3b4':
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

if sys.argv[1:] == ['--publish']:
    today = datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    if today < '2026-10-27' or today >= '2026-10-30':
        raise SystemExit('Candidate expired: rebuild and review before deployment')
elif sys.argv[1:]:
    raise SystemExit('Unknown argument')

print(f"PASS {manifest['release_id']}: {len(files)} files match reviewed manifest")
