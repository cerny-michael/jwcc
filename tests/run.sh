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
  # A suite passes only if it exits cleanly and reports no failures: a throw
  # inside a promise never reaches the exit code, so the tally is checked too.
  local out rc
  out=$("$JSC" "$@" 2>&1); rc=$?
  echo "$out"
  if [ $rc -ne 0 ] || ! echo "$out" | grep -q ' 0 failed$'; then status=1; fi
  echo
}

run "engine: counting, headings, bounds, segmentation" tests/shim.js js/engine.js tests/engine_tests.js
run "engine: the PDF code path"                        tests/shim.js js/engine.js tests/pdf_tests.js
run "data: journal rules and bounds"                   tests/shim.js js/engine.js "$FIXTURE" tests/rules_tests.js
run "page: journal picker, intake, rendering"          tests/dom_shim.js "$FIXTURE" js/engine.js js/app.js tests/app_tests.js

# The real readers in headless Chrome: .docx files the test page builds with
# JSZip, and PDFs from tests/fixtures read by pdf.js. Needs Chrome, and a
# connection to fetch both libraries; with no Chrome it is skipped, not failed.
# It runs in real time rather than on a virtual clock, which stalls pdf.js's
# worker, so the page reports each result line to the server and the script
# reads them back from the server's log.
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
echo "── browser: the real .docx and PDF readers, in headless Chrome"
if [ -x "$CHROME" ]; then
  PORT=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
  LOG=$(mktemp -t wordcount_server)
  python3 -m http.server "$PORT" --bind 127.0.0.1 >"$LOG" 2>&1 &
  SERVER=$!
  PROFILE=$(mktemp -d -t wordcount_chrome)
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break
    sleep 0.3
  done
  "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$PROFILE" \
    --remote-debugging-port=0 "http://127.0.0.1:$PORT/tests/docx_tests.html" >/dev/null 2>&1 &
  BROWSER=$!
  for _ in $(seq 1 120); do
    grep -q 'GET /tests/RESULT/DONE' "$LOG" && break
    sleep 0.5
  done
  kill "$BROWSER" "$SERVER" 2>/dev/null
  wait "$BROWSER" "$SERVER" 2>/dev/null
  OUT=$(grep -o 'GET /tests/RESULT/[^ ]*' "$LOG" | grep -v 'RESULT/DONE' | python3 -c 'import sys, urllib.parse
for line in sys.stdin: print(urllib.parse.unquote(line.strip()[len("GET /tests/RESULT/"):]).rstrip())')
  [ -n "$OUT" ] || OUT="No output from the browser."
  rm -rf "$PROFILE" "$LOG"
  echo "$OUT"
  echo "$OUT" | grep -q ' 0 failed$' || status=1
else
  echo "skipped: no Chrome at $CHROME (set CHROME to a Chrome or Chromium binary)"
fi
echo

if [ $status -eq 0 ]; then echo "All suites passed."; else echo "FAILURES above." >&2; fi
exit $status
