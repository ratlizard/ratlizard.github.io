// Taps, keys and questions sent from a computer, for testing on a Board
// without a person at it. Only a build packed with REMOTE set has this
// (pack.sh). The page connects out to remote_server.mjs on that computer, and
// each command sent over that connection is one of these:
//
//   {op:"tap", x, y, ms}         a finger down at (x, y) for ms (default 80)
//   {op:"drag", path:[[x,y]...], ms}  a finger along the path, ms per step
//   {op:"key", code, key, ms}    a key pressed and released, as KeyboardEvent
//                                code and key ("ArrowUp", "KeyG"/"g")
//   {op:"eval", js}              the value of js, evaluated in the page
//
// x and y are the panel's pixels, as in a Board screenshot. The fingers are
// replayed by touch.js as pointer events, which differ from a real finger's
// only in being untrusted.
import { makeReplayer } from "./touch.js";

const FIRST_CONTACT = 500; // pointerIds 1500 and up, clear of the Board's
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function startRemote(url, report) {
  url = String(url);
  const shown = url.replace(/\?.*/, ""); // the key stays out of the box and the log
  report = ((report) => (k, v) => report(k, String(v).split(url).join(shown)))(report);
  const replay = makeReplayer();
  let contact = FIRST_CONTACT;

  async function finger(path, ms) {
    const contactId = contact++;
    for (const [x, y] of path) {
      replay([{ contactId, x, y }]);
      await wait(ms);
    }
    replay([]);
  }

  function key(code, k, down) {
    const target = document.activeElement && document.activeElement !== document.body
      ? document.activeElement : document.body;
    target.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", {
      code, key: k, bubbles: true, cancelable: true,
    }));
  }

  const ops = {
    async tap({ x, y, ms = 80 }) { await finger([[x, y]], ms); return "tapped"; },
    async drag({ path, ms = 16 }) { await finger(path, ms); return `dragged ${path.length} steps`; },
    async key({ code, key: k = code, ms = 80 }) {
      key(code, k, true);
      await wait(ms);
      key(code, k, false);
      return "pressed";
    },
    async eval({ js }) {
      const v = await (0, eval)(js);
      return typeof v === "string" ? v : JSON.stringify(v);
    },
  };

  function connect() {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      report("remote", `cannot open ${url}: ${e.name} ${e.message}`);
      return;
    }
    ws.onopen = () => report("remote", `connected to ${url}`);
    ws.onclose = () => {
      report("remote", `not connected to ${url}; retrying`);
      setTimeout(connect, 3000);
    };
    ws.onmessage = async (m) => {
      let cmd = {};
      let answer;
      try {
        cmd = JSON.parse(m.data);
        answer = { result: await ops[cmd.op](cmd) };
      } catch (e) {
        answer = { error: String((e && e.stack) || e) };
      }
      ws.send(JSON.stringify({ id: cmd.id, ...answer }));
    };
  }
  connect();
}
