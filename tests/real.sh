#!/bin/bash
# tests/real.sh: syntax check, pack the add-on as an .xpi, test it installed in a real Firefox (real_install.py)
set -e
cd "$(dirname "$0")/.."
for f in src/*.js; do $HOME/.local/node/bin/node --check "$f"; done
rm -f /tmp/snapfire.xpi
# test build: same files, but the toolbar button has no popup, so a click runs capture(tab, "full") directly
python3 -c "
import zipfile, glob, json
m = json.load(open('manifest.json')); del m['action']['default_popup']
z = zipfile.ZipFile('/tmp/snapfire.xpi', 'w', zipfile.ZIP_DEFLATED); z.writestr('manifest.json', json.dumps(m))
[z.write(f) for f in sorted(glob.glob('src/*')) + sorted(glob.glob('icons/*.png'))]"
export LD_LIBRARY_PATH=$HOME/.local/fxlibs/usr/lib/aarch64-linux-gnu:$HOME/.local/chromelibs/usr/lib/aarch64-linux-gnu
exec $HOME/.local/venv-browser/bin/python -I -u tests/real_install.py /tmp/snapfire.xpi
