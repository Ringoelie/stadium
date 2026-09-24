#!/bin/sh
# Build the current source into bench/build/<label> and benchmark it against the v0 reference captures.
set -e
label=$1; shift
npx vite build --outDir bench/build/$label --emptyOutDir >/dev/null 2>&1
node bench/run.mjs $label --ref v0 "$@" > bench/out/$label.log 2>&1
grep -E "shot |quality|MEDIAN|run " bench/out/$label.log
