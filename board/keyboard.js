// A keyboard drawn on the page, for a Board with no keyboard of the system's.
//
// Typing in Cythera is for a character's name and for the player's words in
// conversation. On a phone the player's Type button focuses a hidden input
// (#kb) to raise the phone's keyboard, and the page sends whatever is typed
// into it to the game. The Board's documentation has no on-screen keyboard,
// so on the Board the Type button shows this one instead, and its keys go
// through the same input: a character as an input event, Backspace and
// Return as keydown events, which the page's listeners on #kb already handle.
//
// The pad is added to #hud before the page's script runs, so the page's pad
// code makes it draggable by its title and stores where it was put.

const ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ["Backspace", "⌫", 1.5]],
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "'"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", ["Enter", "Return", 2]],
  [["Shift", "⇧", 1.5], "z", "x", "c", "v", "b", "n", "m", ",", ".", "?"],
  [["Hide", "Hide", 2], ["Space", "space", 7], "-"],
];
const UNIT = 62; // px per key; about 17 mm on the Board's 23.8-inch panel

const CSS = `
  #keys { left: calc(50% - ${(UNIT + 4) * 6}px); bottom: 8px; }
  #keys .row { display: flex; gap: 4px; margin-top: 4px; }
  #keys .k { width: ${UNIT}px; height: ${UNIT - 8}px; font-size: 20px; flex: none; }
  #keys .k.wide { font-size: 15px; }
  #keys.shifted .k.letter { text-transform: uppercase; }
  #keys .k.on { background: rgba(255,220,120,.6); color: #000; }
`;

export function addKeyboard() {
  const hud = document.getElementById("hud");
  const kb = document.getElementById("kb");
  const toggle = document.getElementById("kbtoggle");
  if (!hud || !kb || !toggle) return null;

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const pad = document.createElement("div");
  pad.className = "pad";
  pad.id = "keys";
  pad.hidden = true;
  pad.innerHTML = '<div class="title">KEYBOARD</div>';
  let shift = false;
  const shiftKeys = [];

  for (const row of ROWS) {
    const line = document.createElement("div");
    line.className = "row";
    for (const spec of row) {
      const [key, label, width] = Array.isArray(spec) ? spec : [spec, spec, 1];
      const k = document.createElement("div");
      k.className = "k" + (width > 1 ? " wide" : "") + (/^[a-z]$/.test(key) ? " letter" : "");
      k.textContent = label;
      if (width > 1) k.style.width = `${UNIT * width + 4 * (width - 1)}px`;
      if (key === "Shift") shiftKeys.push(k);
      k.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        k.classList.add("held");
        press(key);
      });
      const up = () => k.classList.remove("held");
      k.addEventListener("pointerup", up);
      k.addEventListener("pointercancel", up);
      line.appendChild(k);
    }
    pad.appendChild(line);
  }
  hud.appendChild(pad);

  function setShift(on) {
    shift = on;
    pad.classList.toggle("shifted", on);
    for (const k of shiftKeys) k.classList.toggle("on", on);
  }
  function sendChar(ch) {
    kb.value = ch;
    kb.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function sendKey(key) {
    kb.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  }
  function press(key) {
    if (key === "Shift") return setShift(!shift);
    if (key === "Hide") return show(false);
    if (key === "Backspace" || key === "Enter") return sendKey(key);
    sendChar(key === "Space" ? " " : shift ? key.toUpperCase() : key);
    if (shift) setShift(false); // one capital, as on a phone keyboard
  }
  function show(on) {
    pad.hidden = !on;
    toggle.classList.toggle("held", on);
  }

  // The Type button shows and hides this pad. The listener is on the window
  // in the capture phase, so it runs before the page's listener on the button,
  // and stopping the event there means the hidden input is never focused.
  addEventListener("pointerdown", (e) => {
    if (!e.target.closest || !e.target.closest("#kbtoggle")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    show(pad.hidden);
  }, { capture: true });

  return { show };
}
