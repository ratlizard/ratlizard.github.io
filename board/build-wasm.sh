#!/bin/sh
# Builds the module for the Board: board/.cache/cythera_web_board.wasm, which
# pack.sh packs.
#
# The Board's browser is a 32-bit program (navigator.platform "Linux armv8l",
# 19 October 2026). A wasm memory there grows by copying into a new block
# beside the old one, so the heap the game needs (past 330 MB once a new game
# has started) cannot be reached by growing: the live module ran out at
# 270 MB growing to start the PowerPC slice, and at 329 MB on a new game's
# OK. This build starts with INITIAL_MB (default 512) reserved in one block,
# while the browser still has the room, and the game played into a new game
# without the heap growing.
#
# It also needs the fork's init_game_owned, which starts the PowerPC slice
# without a second copy of the loaded application.
#
# The target directory is separate from the player's because RUSTFLAGS is
# part of what cargo caches by: sharing one would rebuild both from scratch
# at every switch.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
INITIAL_MB=${INITIAL_MB:-512}
mkdir -p "$here/.cache"
RUSTFLAGS="-C link-arg=--initial-memory=$((INITIAL_MB * 1024 * 1024))" \
  CARGO_TARGET_DIR="$here/.cache/target" CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-2} \
  "$here/../build.sh"
cp "$here/../www/cythera_web.wasm" "$here/.cache/cythera_web_board.wasm"
ls -la "$here/.cache/cythera_web_board.wasm"
