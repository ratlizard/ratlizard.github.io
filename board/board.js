// The player on a Board. pack.sh bundles this and puts it in the page after
// the markup and before every other script, so the pads and #kb exist and
// the page's script has not yet run.
//
// web-pack stops unless window.BoardSDK appears somewhere in the bundle's
// text. It is the Board's native bridge: read here, never set, because the
// SDK reports isOnDevice as true whenever it exists.
import { Board } from "@board.fun/web-sdk";
import { startProbe } from "./probe.js";
import { startTouchAdapter } from "./touch.js";
import { addKeyboard } from "./keyboard.js";
import { startSaveMirror } from "./saves.js";
import { startRemote } from "./remote.js";

console.log(`[board] bridge: ${typeof window.BoardSDK}`);
// The box of facts covers part of the game, so only a test build shows it;
// every build logs them.
const probe = startProbe(Board, { show: !!REMOTE_URL });

// BUNDLED_TUNES is set by pack.sh when the game's tunes, already played
// through QuickTime 3's instruments, are packed in tunes/. Without them the
// page renders the tunes at every launch, since the Board clears the page's
// storage, and on the Board that is about a minute of music on the wrong
// instruments. Turning off the page's QuickTime setting skips the rendering,
// and the page's restoreMusic (patched by pack.sh) adds these to the tunes
// from its Music store.
if (BUNDLED_TUNES) {
  try { localStorage.setItem("qtmusic", "0"); } catch (e) {}
  window.boardTunes = async () => {
    const names = await (await fetch("tunes/index.json")).json();
    const recs = [];
    for (const name of names) {
      const bytes = new Uint8Array(await (await fetch(`tunes/${name}`)).arrayBuffer());
      recs.push({ checksum: parseInt(name, 16), bytes });
    }
    console.log(`[board] ${recs.length} tunes from the bundle`);
    return recs;
  };
}

// The page sizes the game for a phone: 480 high, scaled up to fill the stage,
// which on the Board's 1920x1080 panel was 887x480 drawn at about twice that.
// On a Board the game is the size of the stage in device pixels, drawn one
// to one; the start screen is 640x480 in the middle of it. pack.sh puts the
// call to this in the page's chooseScreen, after it has measured the stage
// (vw, vh, in CSS pixels).
window.boardScreen = (vw, vh) => [
  Math.min(2048, Math.max(640, Math.round(vw * devicePixelRatio))),
  Math.min(2048, Math.max(480, Math.round(vh * devicePixelRatio))),
];

// The pads show only in the page's touch mode, which the page turns on for a
// coarse pointer. Whether the Board's browser reports one is unknown, and the
// Board is played by finger either way.
document.body.classList.add("touch");
addKeyboard();

// REMOTE_URL is set by pack.sh: null, or the address of remote_server.mjs
// for a test build.
if (REMOTE_URL) startRemote(REMOTE_URL, probe.fact);

if (Board.isOnDevice) {
  const replay = startTouchAdapter(Board.input, (how) => probe.fact("touch", how));
  Board.input.subscribe((contacts) => {
    replay(contacts);
    probe.contacts(contacts);
  });

  const mirror = startSaveMirror(Board.save, Board.session, probe.fact);

  // The system menu's Quit: the game's writes go to the browser store first
  // (the page's syncSaves, normally every 2 s), then to the Board's saves.
  // No Save & Quit: saving a character is done in the game, and the menu
  // could only copy what the game had already written.
  Board.pause.setContext({ gameName: "Cythera", offerSaveOption: false });
  Board.pause.onResult(async (result) => {
    if (result.action !== "quit" && result.action !== "save_and_quit") return;
    try { if (typeof window.syncSaves === "function") await window.syncSaves(); } catch (e) {}
    await mirror.flush();
    Board.application.quit();
  });
}
