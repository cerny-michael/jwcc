#!/bin/bash
# Runs the test suite with the JavaScriptCore interpreter that ships with macOS.
# No Node, no npm, no browser. From the repo root:  bash tests/run.sh
set -u
cd "$(dirname "$0")/.."

JSC=${JSC:-/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc}
if [ ! -x "$JSC" ]; then
  echo "No JavaScriptCore interpreter at $JSC" >&2
  echo "On macOS it ships with the system. Elsewhere, set JSC to a jsc or node binary." >&2
  exit 2
fi

FIXTURE=$(mktemp -t journals_fixture).js
trap 'rm -f "$FIXTURE"' EXIT
python3 -c "
import json
d = json.load(open('data/journals.json'))
open('$FIXTURE', 'w').write('var DATA=' + json.dumps(d) + ';')
"

status=0
run() {                        # run <name> <files...>
  local name=$1; shift
  echo "── $name"
  if "$JSC" "$@"; then :; else status=1; fi
  echo
}

run "engine: counting, headings, bounds, segmentation" tests/shim.js js/engine.js tests/engine_tests.js
run "engine: the PDF code path"                        tests/shim.js js/engine.js tests/pdf_tests.js
run "data: journal rules and bounds"                   tests/shim.js js/engine.js "$FIXTURE" tests/rules_tests.js
run "page: journal picker, intake, rendering"          tests/dom_shim.js "$FIXTURE" js/engine.js js/app.js tests/app_tests.js

if [ $status -eq 0 ]; then echo "All suites passed."; else echo "FAILURES above." >&2; fi
exit $status
