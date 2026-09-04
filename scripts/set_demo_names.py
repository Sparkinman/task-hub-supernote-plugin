"""Point package.json and app.json at the demo's component name.

Run by buildDemo.ps1 as: python scripts/set_demo_names.py <pluginKey>

A file rather than an inline here-string: PowerShell's double-quoted here-strings
ate the backslash escapes in the previous inline version and handed python a
syntax error, and its single-quoted form cannot interpolate the key. Written with
json so key order and encoding survive — the PowerShell JSON round-trip reorders
keys, and Set-Content adds a BOM.

app.json's name is what index.js registers the React component as, and the host
resolves that component by PluginConfig.json's pluginKey. They MUST match: a
mismatch installs cleanly and then does nothing at all.
"""

import collections
import io
import json
import os
import sys

NEWLINE = "\n"


def rename(path, fields):
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle, object_pairs_hook=collections.OrderedDict)
    data.update(fields)
    with io.open(path, "w", encoding="utf-8", newline=NEWLINE) as handle:
        json.dump(data, handle, indent=2)
        handle.write(NEWLINE)


def main():
    if len(sys.argv) != 2 or not sys.argv[1].strip():
        print("usage: set_demo_names.py <pluginKey>", file=sys.stderr)
        return 1

    key = sys.argv[1].strip()
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    # package.json's name sets the .snplg and .bundle filenames.
    rename(os.path.join(root, "package.json"), {"name": key})
    # app.json's name is the registered component name.
    rename(os.path.join(root, "app.json"), {"name": key, "displayName": "Task Hub Demo"})

    print("component name set to " + key)
    return 0


if __name__ == "__main__":
    sys.exit(main())
