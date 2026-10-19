// The computer's end of remote.js: a WebSocket the packed page connects to,
// and a plain HTTP port on this machine that passes a command to the page and
// answers with the page's reply.
//
//   node board/remote_server.mjs            page port 8765, command port 8766
//   curl -s localhost:8766 -d '{"op":"tap","x":34,"y":20}'
//   curl -s localhost:8766 -d '{"op":"eval","js":"document.getElementById(\"log\").textContent.slice(-2000)"}'
//
// One page at a time: a new connection replaces the old one. No library, so
// nothing to install: the WebSocket framing below is the subset a browser
// sends (masked frames, text, ping, close).
import http from "node:http";
import crypto from "node:crypto";

const PAGE_PORT = Number(process.env.PAGE_PORT || 8765);
const COMMAND_PORT = Number(process.env.COMMAND_PORT || 8766);
const log = (s) => console.log(`[remote] ${new Date().toISOString().slice(11, 19)} ${s}`);

let page = null;
let nextId = 1;
const waiting = new Map(); // id -> resolve

function frame(opcode, payload) {
  const n = payload.length;
  const head = n < 126 ? Buffer.from([0x80 | opcode, n])
    : n < 65536 ? Buffer.from([0x80 | opcode, 126, n >> 8, n & 255])
    : Buffer.concat([Buffer.from([0x80 | opcode, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  return Buffer.concat([head, payload]);
}

function attach(sock) {
  let buf = Buffer.alloc(0);
  let text = [];
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, opcode = buf[0] & 15, masked = buf[1] & 0x80;
      let len = buf[1] & 127, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const mask = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const body = Buffer.from(buf.subarray(at, at + len));
      buf = buf.subarray(at + len);
      if (mask) for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
      if (opcode === 8) { sock.end(frame(8, Buffer.alloc(0))); return; }
      if (opcode === 9) { sock.write(frame(10, body)); continue; }
      if (opcode === 1 || opcode === 0) {
        text.push(body);
        if (!fin) continue;
        const msg = Buffer.concat(text).toString("utf8");
        text = [];
        let reply;
        try { reply = JSON.parse(msg); } catch { log(`page sent ${msg.slice(0, 200)}`); continue; }
        const done = waiting.get(reply.id);
        if (done) { waiting.delete(reply.id); done(reply); }
      }
    }
  });
}

const pageServer = http.createServer((req, res) => { res.writeHead(426); res.end("WebSocket only\n"); });
pageServer.on("upgrade", (req, sock) => {
  // With KEY set, a connection is accepted only from an address with ?k=KEY
  // in it, so nothing else that reaches this port can take the page's place.
  if (process.env.KEY && new URL(req.url, "http://x").searchParams.get("k") !== process.env.KEY) {
    log(`a connection from ${req.socket.remoteAddress} without the key, closed`);
    sock.destroy();
    return;
  }
  const accept = crypto.createHash("sha1")
    .update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  if (page) page.destroy();
  page = sock;
  log(`page connected from ${req.socket.remoteAddress}`);
  sock.on("close", () => { if (page === sock) { page = null; log("page disconnected"); } });
  sock.on("error", () => {});
  attach(sock);
});
pageServer.listen(PAGE_PORT, "0.0.0.0", () => log(`page port ${PAGE_PORT}`));

const commandServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const answer = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj) + "\n"); };
    if (req.method !== "POST") return answer(200, { connected: !!page });
    if (!page) return answer(503, { error: "no page connected" });
    let cmd;
    try { cmd = JSON.parse(body); } catch (e) { return answer(400, { error: e.message }); }
    cmd.id = nextId++;
    const timer = setTimeout(() => { waiting.delete(cmd.id); answer(504, { error: "no answer from the page" }); }, cmd.timeout || 30000);
    waiting.set(cmd.id, (reply) => { clearTimeout(timer); answer(200, reply); });
    page.write(frame(1, Buffer.from(JSON.stringify(cmd))));
  });
});
commandServer.listen(COMMAND_PORT, "127.0.0.1", () => log(`command port ${COMMAND_PORT}`));
