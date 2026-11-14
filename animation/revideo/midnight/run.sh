#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p build
if [ ! -d node_modules ]; then PUPPETEER_SKIP_DOWNLOAD=true npm ci --no-audit --no-fund; fi
if [ -z "${CHROME_PATH:-}" ]; then
  npx puppeteer browsers install chrome-headless-shell
  CHROME_PATH=$(node -e "import('puppeteer').then(async ({default:p})=>console.log(await p.executablePath({headless:'shell'})))")
  export CHROME_PATH
fi
if [ ! -x "$CHROME_PATH" ]; then echo 'Set CHROME_PATH to a headless Chromium executable.' >&2; exit 1; fi
blender -b -t 3 --python-exit-code 1 -P blender_scene.py >build/blender.log 2>&1
node overlay.cjs
sh finish.sh
