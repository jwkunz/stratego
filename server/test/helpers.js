import { WebSocket } from 'ws';
import { createGameServer } from '../src/server.js';
import { makeConfig, makeHexConfig, randomSetupFor } from '../../single/web/src/game.js';

/** Starts a server on a free port. The computer players answer quickly so tests stay fast. */
export async function startServer(lobby = {}) {
  const game = createGameServer({ lobby: { aiDelayMs: 5, aiOptions: { timeMs: 15 }, ...lobby }, publicDir: '/nonexistent' });
  const addr = await game.listen(0, '127.0.0.1');
  return { game, url: `ws://127.0.0.1:${addr.port}/ws`, http: `http://127.0.0.1:${addr.port}`, port: addr.port };
}

/** A tiny test client: records every message and lets a test await the next one of a given type. */
export class Client {
  constructor(url, name, token, headers) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.view = null;
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
      if (m.t === 'state') this.view = m.view;
      if (m.t === 'lobby') this.view = null;
      this.waiters = this.waiters.filter((w) => !w(m));
    });
    this.opened = new Promise((res, rej) => { this.ws.once('open', res); this.ws.once('error', rej); });
    this.closed = new Promise((res) => this.ws.once('close', (code) => res(code)));
    this.token = token;
  }
  static async connect(url, name, token) {
    const c = new Client(url, name, token);
    await c.opened;
    c.send({ t: 'hello', name, token });
    const w = await c.next('welcome');
    c.token = w.token;
    return c;
  }
  send(m) { this.ws.send(JSON.stringify(m)); }
  /** Resolves with the next message (after this call) matching the type / predicate. */
  next(type, pred = () => true, ms = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type} (${this.name})`)), ms);
      this.waiters.push((m) => {
        if (m.t === type && pred(m)) { clearTimeout(timer); resolve(m); return true; }
        return false;
      });
    });
  }
  /** The next state message whose view matches (the current view is not considered). */
  async state(pred = () => true, ms) { return this.next('state', (m) => pred(m.view), ms); }
  /** Resolves with the current view if it matches, otherwise waits for the next matching one. */
  async until(pred, ms) { return this.view && pred(this.view) ? { view: this.view } : this.state(pred, ms); }
  close() { this.ws.close(); }
}

/** The shared configuration a client rebuilds from a view (this is exactly what the real client does). */
export function configOf(view) {
  if (view.mode === 'hex') return makeHexConfig({ a: view.a, players: view.players.length, lakes: view.lakes });
  return makeConfig(view.size, Array.from({ length: view.size * view.size }, (_, i) => view.lakes.includes(i)));
}
export const setupFor = (view) => randomSetupFor(configOf(view), view.you);

/** Two people in a classic game that has just entered setup. Returns clients tagged with their colour. */
export async function startedPair(url, size = 10) {
  const a = await Client.connect(url, 'Alice');
  const b = await Client.connect(url, 'Bob');
  a.send({ t: 'create', size });
  const created = await a.state();
  b.send({ t: 'join', code: created.view.code });
  const [sa, sb] = await Promise.all([a.until((v) => v.phase === 'setup'), b.until((v) => v.phase === 'setup')]);
  a.color = sa.view.you; b.color = sb.view.you;
  return { a, b, code: created.view.code, red: a.color === 'red' ? a : b, blue: a.color === 'red' ? b : a };
}

/** Both players of a pair submit a random army; resolves with the two views once play has begun. */
export async function bothReady(pair) {
  pair.red.send({ t: 'setup', placements: setupFor(pair.red.view) });
  pair.blue.send({ t: 'setup', placements: setupFor(pair.blue.view) });
  const [r, b] = await Promise.all([pair.red.until((v) => v.phase === 'play'), pair.blue.until((v) => v.phase === 'play')]);
  return [r.view, b.view];
}
