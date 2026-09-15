#!/usr/bin/env bash
#
# Build the demo plugin: a second .snplg, with its own plugin ID, carrying
# invented tasks and a month of invented calendar events.
#
# It installs alongside the real Task Hub rather than replacing it, makes no
# network request, and reads and writes nothing in Document/TaskHub — so it
# cannot see or change a single real setting. For screenshots and recordings.
#
# Four files are swapped for the length of the build and put back afterwards,
# by a trap that fires however the script ends. Nothing is left modified even
# if the build fails or is interrupted.
#
#   app.json            the name index.js registers the component under
#   package.json        decides the output filename
#   PluginConfig.json   the plugin ID, key and display name
#   src/demoflag.ts     turns the invented data on
#
# Usage:  source ~/.plugin-env && ./buildDemo.sh
# Output: build/outputs/TaskHubDemo.snplg

set -euo pipefail
cd "$(dirname "$0")"

BACKUP="$(mktemp -d)"
restore() {
  for f in app.json package.json PluginConfig.json src/demoflag.ts; do
    if [ -f "$BACKUP/$(basename "$f")" ]; then
      cp "$BACKUP/$(basename "$f")" "$f"
    fi
  done
  rm -rf "$BACKUP"
  echo "Restored the working tree."
}
trap restore EXIT

echo "Backing up the four files the demo build swaps..."
for f in app.json package.json PluginConfig.json src/demoflag.ts; do
  cp "$f" "$BACKUP/$(basename "$f")"
done

if [ ! -f PluginConfig.demo.json ]; then
  echo "PluginConfig.demo.json is missing." >&2
  exit 1
fi

echo "Switching to the demo identity..."
cp PluginConfig.demo.json PluginConfig.json
python3 - <<'PY'
import json
app = json.load(open('app.json'))
app['name'] = 'TaskHubDemo'
app['displayName'] = 'Task Hub Demo'
json.dump(app, open('app.json', 'w'), indent=2)

pkg = json.load(open('package.json'))
pkg['name'] = 'TaskHubDemo'
json.dump(pkg, open('package.json', 'w'), indent=2)
PY
sed -i 's/^export const DEMO = false;$/export const DEMO = true;/' src/demoflag.ts
grep -q 'export const DEMO = true;' src/demoflag.ts || { echo "Could not set the demo flag." >&2; exit 1; }

echo "Typechecking the demo build..."
npx tsc --noEmit

# Cleared by hand: the packaging step zips whatever is in build/generated, so a
# bundle left by the real build would otherwise be packaged alongside this one.
rm -rf build/generated

echo "Building..."
./buildPlugin.sh

if [ -f build/outputs/TaskHubDemo.snplg ]; then
  echo
  echo "Demo built: build/outputs/TaskHubDemo.snplg"
else
  echo "The demo package was not produced." >&2
  exit 1
fi
