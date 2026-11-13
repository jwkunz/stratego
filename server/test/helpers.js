import { WebSocket } from 'ws';
import { createGameServer } from '../src/server.js';

export async function startServer(lobby = {}) {
  const game = createGameServer({ lobby, publicDir: '/nonexistent' });
  const addr = await game.listen(0, '127.0.0.1');
  return { game, url: `ws://127.0.0.1:${addr.port}/ws`, http: `http://127.0.0.1:${addr.port}`, port: addr.port };
}

/** A tiny test client: records every message and lets a test await the next one of a given type. */
export class Client {
  constructor(url, name, token, headers) {
    this.name = name;
    this.msgs = [];
    this.waiters = [];
    this.ws = new WebSocket(url, { headers });
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      this.msgs.push(m);
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
  next(type, pred = () => true, ms = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type} (${this.name})`)), ms);
      this.waiters.push((m) => {
        if (m.t === type && pred(m)) { clearTimeout(timer); resolve(m); return true; }
        return false;
      });
    });
  }
  async state(pred = () => true) { return (await this.next('state', (m) => pred(m.view))); }
  close() { this.ws.close(); }
}

/** Two players in a game that has just entered setup. Returns clients tagged with their colour. */
export async function startedPair(url, size = 10) {
  const a = await Client.connect(url, 'Alice');
  const b = await Client.connect(url, 'Bob');
  a.send({ t: 'create', size });
  const created = await a.state();
  b.send({ t: 'join', code: created.view.code });
  const [sa, sb] = await Promise.all([a.state((v) => v.phase === 'setup'), b.state((v) => v.phase === 'setup')]);
  a.color = sa.view.you; b.color = sb.view.you;
  return { a, b, code: created.view.code, red: a.color === 'red' ? a : b, blue: a.color === 'red' ? b : a };
}
