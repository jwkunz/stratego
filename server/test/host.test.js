import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHost } from '../src/host/host.js';
import { createLoopback } from '../src/host/loopback.js';
import { BridgeSocket } from '../src/host/bridge-socket.js';
import { setupFor } from './helpers.js';

/** Stands in for the Android app's native web server: records what the host sends to remote devices. */
function fakeNative() {
  const native = { sent: new Map(), closed: new Map(), listeners: [] };
  native.send = (id, text) => { (native.sent.get(id) || native.sent.set(id, []).get(id)).push(JSON.parse(text)); native.listeners.forEach((f) => f()); };
  native.close = (id, code) => { native.closed.set(id, code); native.listeners.forEach((f) => f()); };
  return native;
}

/** A remote device as the host sees it: frames in through host.onMessage, frames out through native.send. */
class Remote {
  constructor(host, native, id) { this.host = host; this.native = native; this.id = id; this.seen = 0; this.view = null; host.onOpen(id); }
  get msgs() { return this.native.sent.get(this.id) || []; }
  send(obj) { this.host.onMessage(this.id, JSON.stringify(obj)); }
  /** Waits for a message after the ones already consumed that matches `pred`. */
  async next(pred, ms = 3000) {
    const deadline = Date.now() + ms;
    for (;;) {
      while (this.seen < this.msgs.length) {
        const m = this.msgs[this.seen++];
        if (m.t === 'state') this.view = m.view;
        if (pred(m)) return m;
      }
      if (Date.now() > deadline) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  async state(pred = () => true) { return this.next((m) => m.t === 'state' && pred(m.view)); }
}

/** The host's own UI, talking through the in-memory loopback (this is what the page's WebSocket becomes). */
class Ui {
  constructor(host) {
    this.msgs = []; this.view = null; this.seen = 0;
    this.ws = host.connectLoopback();
    this.ws.onmessage = (e) => this.msgs.push(JSON.parse(e.data));
    this.opened = new Promise((r) => { this.ws.onopen = r; });
    this.closedWith = null;
    this.ws.onclose = (e) => { this.closedWith = e.code; };
  }
  send(obj) { this.ws.send(JSON.stringify(obj)); }
  async next(pred, ms = 3000) {
    const deadline = Date.now() + ms;
    for (;;) {
      while (this.seen < this.msgs.length) {
        const m = this.msgs[this.seen++];
        if (m.t === 'state') this.view = m.view;
        if (pred(m)) return m;
      }
      if (Date.now() > deadline) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  async state(pred = () => true) { return this.next((m) => m.t === 'state' && pred(m.view)); }
}

const newHost = (lobbyOptions = {}) => {
  const native = fakeNative();
  const host = createHost({ native, lobbyOptions: { aiDelayMs: 5, aiOptions: { timeMs: 15 }, ...lobbyOptions } });
  return { native, host };
};

test('a remote device says hello and gets a session and the lobby', async () => {
  const { native, host } = newHost();
  const r = new Remote(host, native, 1);
  r.send({ t: 'hello', name: 'Pat' });
  const welcome = await r.next((m) => m.t === 'welcome');
  assert.ok(welcome.token.length >= 32 && welcome.name === 'Pat');
  const lobby = await r.next((m) => m.t === 'lobby');
  assert.deepEqual(lobby.rooms, []);
  host.stop();
});

test('the host plays through the loopback while a remote device joins: a whole classic setup and first move', async () => {
  const { native, host } = newHost();
  const ui = new Ui(host);
  await ui.opened;
  ui.send({ t: 'hello', name: 'Host' });
  await ui.next((m) => m.t === 'welcome');
  const remote = new Remote(host, native, 7);
  remote.send({ t: 'hello', name: 'Guest' });
  await remote.next((m) => m.t === 'welcome');

  ui.send({ t: 'create', size: 10 });
  const code = (await ui.state()).view.code;
  const lobby = await remote.next((m) => m.t === 'lobby' && m.rooms.length === 1);
  assert.equal(lobby.rooms[0].host, 'Host');
  remote.send({ t: 'join', code });
  const [uv, rv] = [(await ui.state((v) => v.phase === 'setup')).view, (await remote.state((v) => v.phase === 'setup')).view];
  assert.notEqual(uv.you, rv.you);

  ui.send({ t: 'setup', placements: setupFor(uv) });
  remote.send({ t: 'setup', placements: setupFor(rv) });
  const [pu, pr] = [(await ui.state((v) => v.phase === 'play')).view, (await remote.state((v) => v.phase === 'play')).view];
  // nobody sees the other's pieces
  assert.ok(pu.board.filter((p) => p && p.o !== pu.you).every((p) => p.r === null));
  assert.ok(pr.board.filter((p) => p && p.o !== pr.you).every((p) => p.r === null));
  const mover = pu.turn === pu.you ? 'ui' : 'remote';
  const [from, to] = (mover === 'ui' ? pu : pr).moves[0];
  (mover === 'ui' ? ui : remote).send({ t: 'move', from, to });
  const seenByOther = await (mover === 'ui' ? remote : ui).next((m) => m.t === 'state' && m.event);
  assert.equal(seenByOther.event.type, 'move');
  assert.equal(seenByOther.event.attacker, undefined, 'a quiet move does not leak the mover\'s rank over the bridge either');
  host.stop();
});

test('computer players run on the host phone: a Hextic game with a remote person and two computers', async () => {
  const { native, host } = newHost();
  const r = new Remote(host, native, 3);
  r.send({ t: 'hello', name: 'Guest' });
  await r.next((m) => m.t === 'welcome');
  r.send({ t: 'create', mode: 'hex', size: 'small', players: 3, ai: 2, level: 'easy' });
  const setup = (await r.state((v) => v.phase === 'setup')).view;
  r.send({ t: 'setup', placements: setupFor(setup) });
  let v = (await r.state((x) => x.phase === 'play')).view;
  const owners = [];
  for (let round = 0; round < 3; round++) {
    const [from, to] = v.moves[0];
    r.send({ t: 'move', from, to });
    for (;;) {
      const m = await r.next((x) => x.t === 'state', 8000);
      if (m.event) owners.push(m.event.owner);
      if (m.view.turn === m.view.you || m.view.phase !== 'play') { v = m.view; break; }
    }
  }
  assert.deepEqual(owners.slice(0, 3), ['red', 'blue', 'green'], 'the table plays in seat order');
  host.stop();
});

test('flooding a remote connection closes it through the bridge', async () => {
  const { native, host } = newHost({ maxMsgsPerSec: 50 });
  const r = new Remote(host, native, 9);
  r.send({ t: 'hello', name: 'Spam' });
  for (let i = 0; i < 200; i++) r.send({ t: 'list' });
  assert.equal(native.closed.get(9), 1008);
  host.stop();
});

test('a remote that drops out of a waiting game takes its seat with it', async () => {
  const { native, host } = newHost({ waitingMs: 40 });
  const r = new Remote(host, native, 4);
  r.send({ t: 'hello', name: 'Gone' });
  await r.next((m) => m.t === 'welcome');
  r.send({ t: 'create', size: 10 });
  await r.state();
  assert.equal(host.lobby.rooms.size, 1);
  host.onClose(4, 1006);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(host.lobby.rooms.size, 0, 'the abandoned room is cleaned up');
  host.stop();
});

test('replacing a connection with the same session token works over the bridge', async () => {
  const { native, host } = newHost();
  const a = new Remote(host, native, 1);
  a.send({ t: 'hello', name: 'Pat' });
  const token = (await a.next((m) => m.t === 'welcome')).token;
  const b = new Remote(host, native, 2);
  b.send({ t: 'hello', token });
  const w = await b.next((m) => m.t === 'welcome');
  assert.equal(w.token, token);
  assert.equal(native.closed.get(1), 4000, 'the older connection is closed with the "replaced" code');
  host.stop();
});

test('stopping the host closes every connection', async () => {
  const { native, host } = newHost();
  const ui = new Ui(host);
  await ui.opened;
  const r1 = new Remote(host, native, 1), r2 = new Remote(host, native, 2);
  assert.equal(host.remoteCount(), 2);
  host.stop();
  assert.equal(native.closed.get(1), 1001); assert.equal(native.closed.get(2), 1001);
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(ui.closedWith, 1001);
  assert.equal(host.remoteCount(), 0);
  void r1; void r2;
});

test('loopback and bridge sockets behave like sockets: ordering, one close event, no sends after close', async () => {
  const { client, server } = createLoopback();
  assert.equal(client.readyState, 0);
  assert.throws(() => client.send('too early'), /not open/);
  const got = [];
  server.on('message', (t) => got.push(t));
  const closes = [];
  server.on('close', (code) => closes.push(code));
  await new Promise((r) => { client.onopen = r; });
  assert.equal(client.readyState, 1);
  client.send('a'); client.send('b'); client.send('c');
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(got, ['a', 'b', 'c']);
  client.close(); client.close();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(closes, [1000], 'exactly one close event');
  assert.throws(() => client.send('late'), /not open/);

  const out = [];
  const bridge = new BridgeSocket({ send: (t) => out.push(t), close: () => out.push('closed') });
  bridge.send('x'); bridge.close(1000); bridge.send('y');
  assert.deepEqual(out, ['x', 'closed']);
});

test('the host core uses no Node-only modules, so it can run inside a WebView', () => {
  const files = [
    'src/lobby.js', 'src/room.js', 'src/host/host.js', 'src/host/bridge-socket.js', 'src/host/loopback.js',
    '../single/web/src/game.js', '../single/web/src/topology.js', '../single/web/src/ai.js',
  ];
  for (const f of files) {
    const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/from\s+['"]node:|require\(|from\s+['"]ws['"]|process\.|Buffer\b/.test(text), `${f} must stay browser-safe`);
  }
});
