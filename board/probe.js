// What the Board's browser gives the page, for the first runs on a Board.
// Each fact goes to the console, which `board-connect logs <appId>` reads,
// and to a small box in the top-right corner, which `board-connect screenshot`
// shows.
import { BoardContactPhase } from "@board.fun/web-sdk";

export function startProbe(Board, { show = true } = {}) {
  const seen = { pointerdown: 0, touchstart: 0, mousedown: 0, click: 0, keydown: 0, boardBegan: 0 };
  const facts = {};
  const box = document.createElement("pre");
  box.id = "boardprobe";
  box.style.cssText =
    "position:fixed;top:4px;right:4px;z-index:99999;margin:0;padding:6px 8px;" +
    "font:12px/1.35 ui-monospace,monospace;color:#f0ede4;background:rgba(0,0,0,.7);" +
    "pointer-events:none;white-space:pre;max-width:46vw;overflow:hidden";

  function show() {
    const lines = Object.entries(facts).map(([k, v]) => `${k}: ${v}`);
    lines.push("events: " + Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(", "));
    box.textContent = lines.join("\n");
  }
  function fact(k, v) {
    facts[k] = v;
    console.log(`[board-probe] ${k}: ${v}`);
    show();
  }

  for (const type of ["pointerdown", "touchstart", "mousedown", "click", "keydown"]) {
    window.addEventListener(type, (e) => {
      seen[type]++;
      if (seen[type] <= 3) {
        const where = "clientX" in e ? ` at ${Math.round(e.clientX)},${Math.round(e.clientY)}` : "";
        const trusted = e.isTrusted ? "" : " (replayed)";
        console.log(`[board-probe] ${type}${where}${type === "keydown" ? " " + e.key : ""}${trusted}`);
      }
      show();
    }, { capture: true, passive: true });
  }

  // The page logs only the message of an uncaught error, and every panic in
  // the module has the message "unreachable"; the stack shows which call it was.
  window.addEventListener("error", (e) => {
    if (e.error && e.error.stack) console.log(`[board-probe] stack: ${e.error.stack}`);
  });

  fact("userAgent", navigator.userAgent);
  fact("onDevice", Board.isOnDevice);
  // "Linux armv8l" is a 32-bit browser on a 64-bit processor, "Linux aarch64"
  // a 64-bit one; a 32-bit one has far less room for the module's heap.
  fact("platform", `${navigator.platform}, ${navigator.hardwareConcurrency} cores, ${navigator.deviceMemory ?? "?"} GB`);
  fact("window", `${innerWidth}x${innerHeight} dpr ${devicePixelRatio}, screen ${screen.width}x${screen.height}`);
  fact("coarse pointer", matchMedia("(pointer: coarse)").matches);
  fact("WebAssembly", typeof WebAssembly === "object");
  fact("SharedArrayBuffer", typeof SharedArrayBuffer === "function");
  fact("crossOriginIsolated", self.crossOriginIsolated === true);
  fact("AudioContext", typeof (window.AudioContext || window.webkitAudioContext) === "function");
  fact("AudioWorklet", typeof AudioWorkletNode === "function");
  fact("Worker", typeof Worker === "function");
  fact("origin", location.href.slice(0, 80));

  // Does storage outlive the app? Each launch counts up in both stores; a
  // count stuck at 1 across relaunches means the store is wiped.
  try {
    const n = Number(localStorage.getItem("board-probe-launches") || 0) + 1;
    localStorage.setItem("board-probe-launches", String(n));
    fact("localStorage launches", n);
  } catch (e) {
    fact("localStorage launches", "error " + e.name);
  }
  try {
    const open = indexedDB.open("board-probe", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("kv");
    open.onerror = () => fact("indexedDB launches", "error " + open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("kv", "readwrite");
      const kv = tx.objectStore("kv");
      const get = kv.get("launches");
      get.onsuccess = () => {
        const n = (get.result || 0) + 1;
        kv.put(n, "launches");
        fact("indexedDB launches", n);
      };
      tx.oncomplete = () => open.result.close();
    };
  } catch (e) {
    fact("indexedDB launches", "error " + e.name);
  }
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((q) => fact("storage quota MB", Math.round(q.quota / 1e6)));
  }

  if (show) document.body.appendChild(box);
  show();

  return {
    fact,
    contacts(list) {
      for (const c of list) {
        if (c.phase !== BoardContactPhase.Began) continue;
        seen.boardBegan++;
        if (seen.boardBegan <= 3) console.log(`[board-probe] board contact began at ${c.x},${c.y} glyph ${c.glyphId}`);
        show();
      }
    },
  };
}
