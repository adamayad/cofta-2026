#!/usr/bin/env bash
# Every build token in the repo must be the same one. Exits non-zero if not.
#
# The failure this catches is silent and nasty: index.html asks for
# app.js?b=cofta-v71 while app.js still imports model.js?b=cofta-v70, so the
# page loads, runs, and quietly computes with last deploy's rules. Nothing
# errors. Run this before every push that touches web/.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(grep -oP "(?<=const VERSION = ')cofta-v\d+" web/sw.js)
tokens=$(grep -ohP "(?<=\?b=)cofta-v\d+" web/sw.js web/index.html web/app.js | sort -u)
count=$(grep -ohP "(?<=\?b=)cofta-v\d+" web/sw.js web/index.html web/app.js | wc -l)

echo "sw.js VERSION : ${version}"
echo "?b= tokens    : $(echo "$tokens" | paste -sd' ')  (${count} references)"

fail=0
if [ "$(echo "$tokens" | wc -l)" -ne 1 ]; then
  echo "FAIL: more than one distinct build token in the tree"; fail=1
fi
if [ "$tokens" != "$version" ]; then
  echo "FAIL: ?b= token (${tokens}) does not match sw.js VERSION (${version})"; fail=1
fi

# Every module and stylesheet the page pulls must carry the token. Counted
# rather than assumed, so adding a fifth module without versioning it fails
# here instead of six weeks later on someone's phone.
expected=16   # index.html 4 + app.js imports 4 + sw.js SHELL 8
if [ "$count" -ne "$expected" ]; then
  echo "FAIL: expected ${expected} ?b= references, found ${count}."
  echo "      If you added or removed a module or stylesheet, update this number"
  echo "      and make sure the new file is versioned in index.html/app.js/sw.js."
  fail=1
fi

# Nothing may reference a bare module URL from the HTML or the import graph.
if grep -nP "(src|href)=\"\./(app|api|model|queue|crests)\.js\"" web/index.html; then
  echo "FAIL: index.html references an unversioned module above"; fail=1
fi
if grep -nP "from '\./(api|model|queue|crests)\.js'" web/app.js; then
  echo "FAIL: app.js imports an unversioned module above"; fail=1
fi

[ "$fail" -eq 0 ] && echo "OK: build tokens agree" || exit 1
