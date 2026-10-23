#!/bin/sh
# Packs the player as a Board web app: board/cythera.webapp.zip, for
# `board-connect install board/cythera.webapp.zip --launch`.
#
#   MODEL  a Board Piece Set Model, required by web-pack and by the device
#          for finger input (default ~/e-z-g-cythera/board/arcade_v1.3.7.tflite)
#   WASM   the module (default: build-wasm.sh's, built if it is not there; the
#          live player's runs out of memory on the Board, as build-wasm.sh
#          explains)
#   GAME   a Cythera installer or installed-folder .sit to bundle as game.sit
#          (default: cythera-reference's installed folder, which www/game.sit
#          links to in the main checkout; GAME= leaves it out, and the Board
#          fetches from archive.org instead)
#   QT     QuickTime 3's installer, QUICKTIM.EXE, whose instruments the
#          music is played on (default: a copy in board/.cache/, else the one
#          grimoire's suite leaves in $TMPDIR). The Board clears the page's
#          storage at every launch, so a copy fetched from archive.org would be
#          fetched again each time. QT= leaves it out.
#   TUNES  a folder of the game's tunes already played through QuickTime 3's
#          instruments, one WAV named for each tune's checksum (default: the
#          workspace's tune-library-qt/, which DISK.md says how to rebuild).
#          With it QT is left out, since nothing on the Board renders tunes.
#          TUNES= leaves them out.
#   REMOTE a test build only: ws://<this computer>:8765, the address of
#          remote_server.mjs, from which the page is sent taps and keys
#          (remote.js)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
www="$here/../www"
MODEL=${MODEL-"$HOME/e-z-g-cythera/board/arcade_v1.3.7.tflite"}
GAME=${GAME-"$here/../../cythera-reference/game/installed-folders/Cythera Installed Folder.sit"}
TUNES=${TUNES-"$HOME/e-z-g-cythera/tune-library-qt"}
[ -d "$TUNES" ] || TUNES=
[ -z "$TUNES" ] || QT=${QT-}
if [ -z "${QT+set}" ]; then
  QT="$here/.cache/QUICKTIM.EXE"
  [ -f "$QT" ] || QT="${TMPDIR:-/tmp}/QUICKTIM.EXE"
fi

cd "$here"
[ -d node_modules ] || npm install --silent
if [ -z "${WASM-}" ]; then
  WASM=.cache/cythera_web_board.wasm
  [ -f "$WASM" ] || ./build-wasm.sh
fi

rm -rf dist && mkdir -p dist
cp -R "$www/delv" "$www/qt-music.js" dist/
cp "$WASM" dist/cythera_web.wasm
[ -z "$GAME" ] || cp -L "$GAME" dist/game.sit
cp "$MODEL" dist/model.tflite
[ -z "$QT" ] || cp "$QT" dist/QUICKTIM.EXE
if [ -n "$TUNES" ]; then
  mkdir dist/tunes
  cp "$TUNES"/*.wav dist/tunes/
  (cd dist/tunes && ls *.wav | node -e 'console.log(JSON.stringify(require("fs").readFileSync(0, "utf8").trim().split("\n")))' > index.json)
  tunes=true
else
  tunes=false
fi
if [ -n "${REMOTE-}" ]; then
  remote="\"$REMOTE\""
  echo "pack.sh: a test build, with commands from $REMOTE"
else
  remote=null
fi
npx esbuild board.js --bundle --format=iife --outfile=dist/board.js --log-level=warning \
  "--define:REMOTE_URL=$remote" "--define:BUNDLED_TUNES=$tunes"
# board.js goes after the markup and before every other script, for the
# reason in the comment at the top of board.js.
# With QT, the page's one address for the instruments becomes the bundled copy.
# With TUNES, restoreMusic adds the bundled tunes (board.js) to the stored ones.
tunes_hook='s#^  try { recs = await listMusic(); } catch (e) { return 0; }$#&\
  if (window.boardTunes) recs = recs.concat(await window.boardTunes());#'
[ "$tunes" = true ] || tunes_hook=''
# With board.js, the game's size comes from window.boardScreen, called in
# chooseScreen once the stage is measured.
screen_hook='s#^  const vh = Math.max(1, Math.round(body.height - bar.height - insetY));$#&\
  if (window.boardScreen) return window.boardScreen(vw, vh);#'
qt_url='s#^const QT_INSTALLER_URL = .*#const QT_INSTALLER_URL = '"'QUICKTIM.EXE'"';#'
[ -n "$QT" ] || qt_url=''
sed -e 's#<script src="delv/mac-bytes.js"></script>#<script src="board.js"></script>\n&#' \
  -e "$screen_hook" -e "$qt_url" -e "$tunes_hook" "$www/index.html" > dist/index.html
grep -q 'src="board.js"' dist/index.html
grep -q "window.boardScreen(vw, vh)" dist/index.html
[ "$tunes" = false ] || grep -q "window.boardTunes" dist/index.html
[ -z "$QT" ] || grep -q "^const QT_INSTALLER_URL = 'QUICKTIM.EXE';" dist/index.html

npx web-pack dist --name Cythera --model model.tflite -o cythera.webapp.zip
