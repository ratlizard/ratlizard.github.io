#!/bin/sh
# Builds the native Board app: the player's module (cythera-web) compiled for
# 64-bit Android instead of WebAssembly, linked with jni.c into
# libdeerlizard.so, and the Java activity around it, into
# board-native/.cache/deerlizard.apk.
#
# The Board's browser is a 32-bit program (board/build-wasm.sh), and inside
# an APK its WebView is still 32-bit; a native library is 64-bit ARM.
#
#   GAME   the Cythera archive the app boots (default: cythera-reference's
#          installed folder, as board/pack.sh)
#   APP    a folder holding the program patched by grimoire's
#          utilities/app_patch.mjs, Cythera.data and Cythera.rsrc, booted in
#          place of the archive's (default ~/e-z-g-cythera/patches/app-walk-path,
#          made by `node utilities/app_patch.mjs ../cythera-reference/game/Cythera.hqx
#          ../patches/app-walk-path --only walk-to,walk-path` in grimoire: a
#          piece's command walks the hero to its target; APP= boots the
#          program unpatched)
#   QT     QuickTime 3's installer; the fork renders each tune on its
#          instruments when the tune starts (default
#          ~/e-z-g-cythera/work/QUICKTIM.EXE; QT= leaves it out)
#   TUNES  pre-rendered tunes, as board/pack.sh; an installed tune plays in
#          place of the instruments (default tune-library-qt/ only when QT is
#          missing)
#   AAR    the Board SDK's board.aar, unzipped (default the one in
#          e-z-g-disassembly's reference/carmen-time/board/aar)
#   SEED   a test build: NAME=FOLDER, a kit save folder put in the game's
#          folder as character NAME the first time the app starts
#   REMOTE a test build: the port for taps and keys sent from this
#          computer (Remote.java)
#   CPU    ppc (default), the PowerPC program on the fork's interpreter, or
#          68k, the 68K program with the fork's JIT (JIT=0: without it)
#   KEYSTORE  the signing key; an installed app is updated only with the key
#          it was signed with (default ~/e-z-g-cythera/board/deerlizard.keystore,
#          outside the repository so that it survives the removal of a front,
#          and made once when it is missing)
#
# Install with `board-connect install .cache/deerlizard.apk` from ~.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo="$here/.."
GAME=${GAME-"$repo/../cythera-reference/game/installed-folders/Cythera Installed Folder.sit"}
QT=${QT-"$HOME/e-z-g-cythera/work/QUICKTIM.EXE"}
[ -f "$QT" ] || QT=
if [ -n "$QT" ]; then TUNES=${TUNES-}; else TUNES=${TUNES-"$HOME/e-z-g-cythera/tune-library-qt"}; fi
APP=${APP-"$HOME/e-z-g-cythera/patches/app-walk-path"}
AAR=${AAR:-$HOME/e-z-g-disassembly/reference/carmen-time/board/aar}
cache="$here/.cache"
mkdir -p "$cache"
KEYSTORE=${KEYSTORE:-$HOME/e-z-g-cythera/board/deerlizard.keystore}

TC="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin"
NDK="$HOME/Library/Android/sdk/ndk/android-ndk-r27c/toolchains/llvm/prebuilt/darwin-x86_64"
CC="$NDK/bin/aarch64-linux-android29-clang"
SDK=$HOME/Library/Android/sdk BT=$SDK/build-tools/34.0.0 JAR=$SDK/platforms/android-34/android.jar
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home

# The module as a static library; jni.c supplies the cw_log that the page
# supplies on the web. Cargo writes each target under a folder named for it,
# so this build and the player's share the main checkout's target directory.
target=${CARGO_TARGET_DIR:-$HOME/e-z-g-cythera/ratlizard.github.io/target}
CPU=${CPU:-ppc}
set --
if [ "$CPU" = 68k ] && [ "${JIT:-1}" = 1 ]; then
  # The 68K program with the fork's JIT. The fork's lock file names m68k
  # 0.14.4, and no published release, 0.14.6 included, has the fix for the RTS
  # fault that m68k-patched/ was made for (the trace cache resumes a region
  # that ends on a guarded return at the word after the RTS). A long run on
  # this build can fault, so use JIT=0, or build the fork against
  # m68k-patched/. This build's cache goes in a separate target folder.
  set -- --features jit
  target="$target/board-68k"
fi
(cd "$repo/cythera-web" && PATH="$TC/bin:$PATH" RUSTC="$TC/bin/rustc" \
  CC_aarch64_linux_android="$CC" CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$CC" \
  CARGO_TARGET_DIR="$target" CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-4} \
  "$TC/bin/cargo" rustc --release --target aarch64-linux-android "$@" --crate-type staticlib)
work="$cache/build"; rm -rf "$work"; mkdir -p "$work/classes" "$work/dex" "$work/assets/tunes" "$work/stage/lib/arm64-v8a"
"$CC" -shared -fPIC -O2 -o "$work/stage/lib/arm64-v8a/libdeerlizard.so" "$here/jni.c" "$here/screen.c" \
  "$target/aarch64-linux-android/release/libcythera_web.a" -landroid -llog -lEGL -lGLESv2 -lm -ldl -Wl,--gc-sections

"$JAVA_HOME/bin/javac" --release 8 -nowarn -classpath "$JAR:$AAR/classes.jar" -d "$work/classes" $(find "$here/src" -name '*.java') > "$work/javac.log" 2>&1 || { cat "$work/javac.log"; exit 1; }
"$BT/d8" --release --min-api 29 --lib "$JAR" --output "$work/dex" $(find "$work/classes" -name '*.class') "$AAR/classes.jar" 2>&1 | grep -v -E "^Warning|Missing class|is not found|^ *$" || true
if [ -n "$APP" ]; then
  # The archive as the fork's web pack, with the patched program's forks in
  # place of the program's (swap_program.py); load_game reads either.
  (cd "$repo/cythera-web" && PATH="$TC/bin:$PATH" CARGO_TARGET_DIR="$target" CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-4} \
    "$TC/bin/cargo" run -q --release --example pack_game -- "$GAME" "$work/game.kpk")
  python3 "$here/swap_program.py" "$work/game.kpk" "$APP" "$work/assets/game.sit"
else
  cp -L "$GAME" "$work/assets/game.sit"
fi
cp "$AAR/../models/chop_chop_v1.3.0.tflite" "$work/assets/"   # PieceStick.java
# The chef's dial draws the program's cursors (Rings.java, cursors.py); with
# APP= it has no program's resource fork to take them from, and writes words.
if [ -n "$APP" ]; then
  mkdir -p "$work/assets/cursors"
  python3 "$here/cursors.py" "$APP/Cythera.rsrc" "$work/assets/cursors" $(sed -n 's/.*CURSORS = {\(.*\)};.*/\1/p' "$here/src/io/github/ratlizard/deerlizard/Rings.java" | tr ',' ' ')
fi
mkdir -p "$work/assets/prefs"   # Prefs.java: a preferences file the game wrote
cp "$repo/../cythera-workbench/tools/drive-scripts/fixtures/System Folder/Preferences/Cythera Preferences/resource.fork" "$work/assets/prefs/"
[ -z "$TUNES" ] || cp "$TUNES"/*.wav "$work/assets/tunes/"
[ -z "$QT" ] || cp "$QT" "$work/assets/quicktime.exe"   # Emulator.boot
if [ -n "${SEED-}" ]; then
  mkdir -p "$work/assets/seed/${SEED%%=*}"
  cp "${SEED#*=}/metadata.json" "${SEED#*=}/data.fork" "${SEED#*=}/resource.fork" "$work/assets/seed/${SEED%%=*}/"
fi
echo "$CPU" > "$work/assets/cpu"   # Emulator.boot: which program to run
[ -z "${REMOTE-}" ] || { echo "$REMOTE" > "$work/assets/remote"; echo "build.sh: a test build, with commands on port $REMOTE"; }
"$BT/aapt2" link -o "$work/base.apk" --manifest "$here/AndroidManifest.xml" -I "$JAR" -A "$work/assets" -0 sit -0 wav
cp "$AAR/jni/arm64-v8a/libboard.so" "$AAR/jni/arm64-v8a/libtensorflowlite.so" "$work/stage/lib/arm64-v8a/"
cp "$work/dex/classes.dex" "$work/stage/"
(cd "$work/stage" && zip -q -r "$work/base.apk" classes.dex lib)
"$BT/zipalign" -f -p 4 "$work/base.apk" "$work/aligned.apk"
[ -f "$KEYSTORE" ] || "$JAVA_HOME/bin/keytool" -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias debug -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Deerlizard Debug" >/dev/null 2>&1
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android --out "$cache/deerlizard.apk" "$work/aligned.apk"
ls -l "$cache/deerlizard.apk"
