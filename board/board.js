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

console.log(`[board] bridge: ${typeof window.BoardSDK}`);
const probe = startProbe(Board);

// The pads show only in the page's touch mode, which the page turns on for a
// coarse pointer. Whether the Board's browser reports one is unknown, and the
// Board is played by finger either way.
document.body.classList.add("touch");
addKeyboard();

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
