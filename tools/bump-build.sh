#!/usr/bin/env bash
# Bump the build token everywhere it appears, in one shot.
#
#   tools/bump-build.sh          -> next number after the current one
#   tools/bump-build.sh 75       -> set it to 75 explicitly
#
# WHY THIS EXISTS. The token appears in eight places across three files, and
# they must all agree or the app half-updates in ways nobody notices: a stale
# model.js under a fresh app.js is a working page computing yesterday's
# standings. Bumping by hand across three files is exactly the kind of thing
# that gets 90% done at 2am the night before a tournament. One command, one
# number, and `tools/check-build.sh` fails loudly if they ever drift.
#
# THIS IS NOT A BUILD STEP. The repo still contains plain, servable files at
# all times; this only rewrites literals in place. Run it, commit the result.
set -euo pipefail
cd "$(dirname "$0")/.."

cur=$(grep -oP "(?<=const VERSION = 'cofta-v)\d+" web/sw.js)
next=${1:-$((cur + 1))}
echo "build token: v${cur} -> v${next}"

# 1. the service worker's cache name and its precache list
sed -i "s/const VERSION = 'cofta-v${cur}'/const VERSION = 'cofta-v${next}'/" web/sw.js

# 2. every ?b=cofta-vNN in the worker, the HTML and the module imports
sed -i "s/?b=cofta-v${cur}/?b=cofta-v${next}/g" web/sw.js web/index.html web/app.js

echo
tools/check-build.sh
