// An in-memory connection between the host's own UI (which looks like a browser WebSocket) and the Lobby running in
// the same page. It needs no network, so the person hosting plays through exactly the same protocol as everyone else.
import { BridgeSocket } from './bridge-socket.js';

const later = (fn) => queueMicrotask(fn);

/** WebSocket-shaped client end: onopen / onmessage / onclose / onerror, send(), close(), readyState. */
class LoopbackClient {
  constructor() {
    this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
    this.peer = null; // set by createLoopback
  }

  send(text) {
    if (this.readyState !== 1) throw new Error('The connection is not open');
    later(() => this.peer.receive(String(text)));
  }

  close() {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    later(() => { this.peer.remoteClosed(1000); if (this.onclose) this.onclose({ code: 1000 }); });
  }
}

/** Returns { client, server }: hand `server` to Lobby.connect and give `client` to the UI as its WebSocket. */
export function createLoopback() {
  const client = new LoopbackClient();
  const server = new BridgeSocket({
    send: (text) => later(() => { if (client.readyState === 1 && client.onmessage) client.onmessage({ data: text }); }),
    close: (code) => later(() => {
      if (client.readyState === 3) return;
      client.readyState = 3;
      if (client.onclose) client.onclose({ code });
    }),
  });
  client.peer = server;
  later(() => { client.readyState = 1; if (client.onopen) client.onopen({}); });
  return { client, server };
}
