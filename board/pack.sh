#!/bin/sh
# Packs the player as a Board web app: board/cythera.webapp.zip, for
# `board-connect install board/cythera.webapp.zip --launch`.
#
#   MODEL  a Board Piece Set Model, required by web-pack and by the device
#          for finger input (default ~/e-z-g-cythera/board/arcade_v1.3.7.tflite)
#   WASM   the module (default: the live player's, fetched once to board/.cache/)
#   GAME   a Cythera installer or installed-folder .sit to bundle as game.sit
#          (default: cythera-reference's installed folder, which www/game.sit
#          links to in the main checkout; GAME= leaves it out, and the Board
#          fetches from archive.org instead)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
www="$here/../www"
MODEL=${MODEL-"$HOME/e-z-g-cythera/board/arcade_v1.3.7.tflite"}
GAME=${GAME-"$here/../../cythera-reference/game/installed-folders/Cythera Installed Folder.sit"}

cd "$here"
[ -d node_modules ] || npm install --silent
if [ -z "${WASM-}" ]; then
  mkdir -p .cache
  WASM=.cache/cythera_web.wasm
  [ -f "$WASM" ] || curl -fsSL https://ratlizard.github.io/cythera_web.wasm -o "$WASM"
fi

rm -rf dist && mkdir -p dist
cp -R "$www/delv" "$www/qt-music.js" dist/
cp "$WASM" dist/cythera_web.wasm
[ -z "$GAME" ] || cp -L "$GAME" dist/game.sit
cp "$MODEL" dist/model.tflite
npx esbuild board.js --bundle --format=iife --outfile=dist/board.js --log-level=warning
# board.js goes after the markup and before every other script, for the
# reason in the comment at the top of board.js.
sed 's#<script src="delv/mac-bytes.js"></script>#<script src="board.js"></script>\n&#' \
  "$www/index.html" > dist/index.html
grep -q 'src="board.js"' dist/index.html

npx web-pack dist --name Cythera --model model.tflite -o cythera.webapp.zip
