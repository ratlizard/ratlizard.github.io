// Finger contacts from Board.input, replayed to the page as pointer events.
//
// The Board's documentation describes touch only as Board.input's per-frame
// contact lists. Whether its browser also gives the page ordinary pointer
// events is not in it, and the player reads pointer events and nothing else.
// The first finger settles it: a real (trusted) pointerdown within WAIT ms of
// the first contact means the browser delivers them, and nothing is replayed
// from then on; with none in that time, every finger is replayed. A first
// tap shorter than WAIT is lost.
//
// A replayed finger is a pointer the browser has never seen, so its
// setPointerCapture would throw. Capture for replayed ids is kept here
// instead, and their moves and lifts go to the capturing element as a real
// captured pointer's would.

const WAIT = 150;
const FIRST_ID = 1000; // pointerIds from here up are replayed fingers
const TAP_SLOP = 12; // CSS pixels a finger may drift and still click

export function startTouchAdapter(input, report) {
  let mode = "undecided"; // then "native" or "replayed"
  let firstAt = 0;
  const captured = new Map(); // pointerId -> element
  const fingers = new Map(); // contactId -> { id, x, y, x0, y0, target }

  addEventListener("pointerdown", (e) => {
    if (e.isTrusted && mode === "undecided") settle("native");
  }, { capture: true });

  const proto = Element.prototype;
  const realSet = proto.setPointerCapture;
  const realRelease = proto.releasePointerCapture;
  const realHas = proto.hasPointerCapture;
  proto.setPointerCapture = function (id) {
    if (id >= FIRST_ID) captured.set(id, this);
    else return realSet.call(this, id);
  };
  proto.releasePointerCapture = function (id) {
    if (id >= FIRST_ID) captured.delete(id);
    else return realRelease.call(this, id);
  };
  proto.hasPointerCapture = function (id) {
    return id >= FIRST_ID ? captured.get(id) === this : realHas.call(this, id);
  };

  function settle(m) {
    mode = m;
    report(m === "native" ? "native pointer events" : "replayed from Board.input");
  }

  // Contacts are in the panel's 1920x1080 pixels; the page's are CSS pixels.
  const toPage = (c) => [c.x * innerWidth / screen.width, c.y * innerHeight / screen.height];

  const primaryId = () => {
    let lowest = Infinity;
    for (const f of fingers.values()) lowest = Math.min(lowest, f.id);
    return lowest;
  };

  function fire(type, f) {
    const t = captured.get(f.id) || document.elementFromPoint(f.x, f.y) || document.body;
    const live = type !== "pointerup";
    t.dispatchEvent(new PointerEvent(type, {
      pointerId: f.id, pointerType: "touch", isPrimary: f.id === primaryId(),
      clientX: f.x, clientY: f.y, screenX: f.x, screenY: f.y,
      button: type === "pointermove" ? -1 : 0, buttons: live ? 1 : 0,
      pressure: live ? 0.5 : 0, width: 20, height: 20,
      bubbles: true, cancelable: true, composed: true,
    }));
    return t;
  }

  function lift(contactId, f) {
    fire("pointerup", f);
    captured.delete(f.id);
    fingers.delete(contactId);
    // A finger that went down and up in about one place is a tap, and the
    // page's buttons listen for click.
    if (Math.hypot(f.x - f.x0, f.y - f.y0) > TAP_SLOP) return;
    const under = document.elementFromPoint(f.x, f.y);
    if (under && (under === f.target || f.target.contains(under) || under.contains(f.target))) {
      under.dispatchEvent(new MouseEvent("click", {
        clientX: f.x, clientY: f.y, bubbles: true, cancelable: true, composed: true,
      }));
    }
  }

  return function frame(contacts) {
    if (mode === "native") return;
    const fingersNow = contacts.filter((c) => c.glyphId === 0);
    if (mode === "undecided") {
      if (!fingersNow.length) return;
      if (!firstAt) firstAt = performance.now();
      if (performance.now() - firstAt < WAIT) return;
      settle("replayed");
    }
    const seen = new Set();
    for (const c of fingersNow) {
      const [x, y] = toPage(c);
      let f = fingers.get(c.contactId);
      seen.add(c.contactId);
      if (!f) {
        f = { id: FIRST_ID + c.contactId, x, y, x0: x, y0: y, target: null };
        fingers.set(c.contactId, f);
        f.target = fire("pointerdown", f);
      } else if (x !== f.x || y !== f.y) {
        f.x = x; f.y = y;
        fire("pointermove", f);
      }
    }
    // The SDK removes a contact from the list on its Ended or Canceled frame
    // rather than passing that frame on, so a finger no longer in the list
    // has been lifted, at the last place it was seen.
    for (const [contactId, f] of [...fingers]) if (!seen.has(contactId)) lift(contactId, f);
  };
}
