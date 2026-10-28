#!/usr/bin/env bash
# Re-mount the Forge3D plugin in the running DeepSeek Harness, without
# restarting the app.
#
# The desktop profile is watched: removing the bundle entry unmounts the
# plugin's fiber, adding it back mounts a fresh one — new host modules and a
# freshly fetched client bundle (the canvas view remounts and re-fetches).
#
# Usage: ./scripts/reload-plugin.sh
set -euo pipefail

PROFILE="${DSH_PROFILE_DIR:-$HOME/.dsh/profiles/desktop}"
PLUGIN="@forge3d/dsh-plugin"
SETTLE="${1:-2}"

toggle() {
  python3 - "$1" <<'PY'
import json, sys
path = sys.argv[1]
plugin = '@forge3d/dsh-plugin'
data = json.load(open(path))
bundles = data['dsh']['profile']['bundles']
if '--off' in sys.argv[2:]:
    data['dsh']['profile']['bundles'] = [b for b in bundles if b != plugin]
else:
    if plugin not in bundles:
        data['dsh']['profile']['bundles'] = bundles + [plugin]
json.dump(data, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
PY
}

cd "$PROFILE"
echo "→ unmount"
python3 - "$PROFILE/package.json" --off <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
data['dsh']['profile']['bundles'] = [b for b in data['dsh']['profile']['bundles'] if b != '@forge3d/dsh-plugin']
json.dump(data, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
PY
sleep "$SETTLE"
echo "→ mount"
python3 - "$PROFILE/package.json" <<'PY'
import json, sys
path = sys.argv[1]
data = json.load(open(path))
bundles = data['dsh']['profile']['bundles']
if '@forge3d/dsh-plugin' not in bundles:
    data['dsh']['profile']['bundles'] = bundles + ['@forge3d/dsh-plugin']
json.dump(data, open(path, 'w'), indent=2)
open(path, 'a').write('\n')
PY
sleep 1
echo "✓ remounted"
