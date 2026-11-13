// Sessions, rooms and the WebSocket message protocol. Transport-agnostic: anything with the `ws` socket API works.
//
// Client -> server (all JSON, `t` is the message type):
//   hello {name?, token?}     identify; send the token from an earlier welcome to resume a session
//   rename {name}             change your display name (not while in a game)
//   list                      ask for the list of open games
//   create {mode, size, players, ai, level, teams}
//                             open a new game. mode 'square' (default; size 10|12|16|20, always 2 players) or
//                             'hex' (size 'small'|'medium'|'large', players 2-6). `ai` = how many of the other
//                             seats are computer players (at `level`: easy|medium|hard), `teams` = a team label
//                             ('A'|'B'|'C'|'') per seat (hex only)
//   join {code}               take the first open seat of an open game
//   seat {seat, type?, level?, team?}
//                             host only, while waiting: make a seat 'ai' or 'open', set its difficulty or team
//   fillAI {level?}           host only: every open seat becomes a computer player and the game moves on
//   lakes                     host only: re-roll the lakes of a larger board
//   leave                     leave the current game (you drop out of one in progress)
//   setup {placements}        lock in your army: {cell: rank}
//   unready                   take back a locked-in setup
//   move {from, to}           play a move (cell indices of the shared, canonical board)
//   resign                    drop out of the game in progress
//   rematch                   ask for another game with the same people
//
// Server -> client:
//   welcome {token, name}     your session token (keep it secret; it is how you resume)
//   lobby {rooms: [{code, host, mode, size, players, open, ai}]}
//   state {view, event}       your private view of your game; `event` describes what just happened (or null)
//   error {msg}
import { Room, GameError } from './room.js';

/** A random session token. Uses the Web Crypto API, which exists in Node 20+ and in browsers/WebViews alike. */
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const OPEN = 1; // ws.OPEN

export const cleanName = (raw) => {
  const s = String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
  return s || `Player ${Math.floor(1000 + Math.random() * 9000)}`;
};

export class Lobby {
  /**
   * @param {object} opts
   * @param {number} opts.graceMs    how long a dropped player can come back to a game before they drop out
   * @param {number} opts.waitingMs  how long an open game with no connected host is kept
   * @param {number} opts.idleMs     how long a session with no game and no connection is remembered
   * @param {number} opts.maxMsgsPerSec  flood limit per connection (a person never gets close to it)
   * @param {number} opts.aiDelayMs  pause before a computer player moves (so people can follow the game)
   * @param {object} opts.aiOptions  options passed to the AI (e.g. {timeMs} to shorten its thinking in tests)
   */
  constructor({ graceMs = 120_000, waitingMs = 60_000, idleMs = 600_000, maxMsgsPerSec = 100, aiDelayMs = 700, aiOptions = {}, log = () => {} } = {}) {
    this.maxMsgsPerSec = maxMsgsPerSec;
    this.graceMs = graceMs;
    this.waitingMs = waitingMs;
    this.idleMs = idleMs;
    this.aiDelayMs = aiDelayMs;
    this.aiOptions = aiOptions;
    this.log = log;
    this.sessions = new Map(); // token -> {token, name, ws, roomCode, dropTimer}
    this.rooms = new Map(); // code -> Room
  }

  // ---- transport ------------------------------------------------------------------------------
  connect(ws) {
    const conn = { ws, session: null, stamps: [] };
    ws.on('message', (data) => this.onMessage(conn, data));
    ws.on('close', () => this.onClose(conn));
    ws.on('error', () => {});
  }

  send(session, msg) {
    const ws = session && session.ws;
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  }

  error(conn, msg) {
    if (conn.ws.readyState === OPEN) conn.ws.send(JSON.stringify({ t: 'error', msg }));
  }

  onMessage(conn, data) {
    // crude flood protection: too many messages in a second drops the connection
    const now = Date.now();
    conn.stamps = conn.stamps.filter((t) => now - t < 1000);
    conn.stamps.push(now);
    if (conn.stamps.length > this.maxMsgsPerSec) { conn.ws.close(1008, 'too many messages'); return; }

    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return this.error(conn, 'Bad message'); }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return this.error(conn, 'Bad message');
    if (msg.t === 'hello') return this.hello(conn, msg);
    if (!conn.session) return this.error(conn, 'Say hello first');
    try {
      this.handle(conn.session, msg);
    } catch (e) {
      if (e instanceof GameError) this.error(conn, e.message);
      else { this.log('internal error', e); this.error(conn, 'Server error'); }
    }
  }

  // ---- sessions -------------------------------------------------------------------------------
  hello(conn, msg) {
    let s = typeof msg.token === 'string' ? this.sessions.get(msg.token) : null;
    if (s) {
      if (s.ws && s.ws !== conn.ws) s.ws.close(4000, 'replaced by a newer connection');
      clearTimeout(s.dropTimer);
      s.ws = conn.ws;
    } else {
      s = { token: randomToken(), name: cleanName(msg.name), ws: conn.ws, roomCode: null, dropTimer: null };
      this.sessions.set(s.token, s);
    }
    conn.session = s;
    this.send(s, { t: 'welcome', token: s.token, name: s.name });
    const room = this.roomOf(s);
    if (room) {
      room.setConnected(s.token, true);
      this.sendState(room);
    } else {
      s.roomCode = null;
      this.send(s, this.lobbyMessage());
    }
  }

  onClose(conn) {
    const s = conn.session;
    if (!s || s.ws !== conn.ws) return; // already replaced by a newer connection
    s.ws = null;
    const room = this.roomOf(s);
    if (!room) {
      s.dropTimer = setTimeout(() => this.sessions.delete(s.token), this.idleMs);
      s.dropTimer.unref?.();
      return;
    }
    room.setConnected(s.token, false);
    this.sendState(room);
    const wait = room.phase === 'waiting' ? this.waitingMs : this.graceMs;
    s.dropTimer = setTimeout(() => this.expire(s), wait);
    s.dropTimer.unref?.();
  }

  /** A dropped player did not come back in time. */
  expire(s) {
    const room = this.roomOf(s);
    if (room) this.removeFromRoom(room, s, 'abandoned');
    if (!s.ws) this.sessions.delete(s.token);
  }

  roomOf(s) { return s.roomCode ? this.rooms.get(s.roomCode) || null : null; }

  // ---- protocol -------------------------------------------------------------------------------
  handle(s, msg) {
    switch (msg.t) {
      case 'list': return this.send(s, this.lobbyMessage());
      case 'create': return this.create(s, msg);
      case 'join': return this.join(s, msg.code);
      case 'rename':
        if (this.roomOf(s)) throw new GameError('Finish or leave your game first');
        s.name = cleanName(msg.name);
        return this.send(s, { t: 'welcome', token: s.token, name: s.name });
      default: break;
    }
    const room = this.roomOf(s);
    if (!room) throw new GameError('You are not in a game');
    let event = null;
    switch (msg.t) {
      case 'leave': return this.removeFromRoom(room, s, 'left'); // also refreshes everyone's lobby list
      case 'seat': room.configureSeat(s.token, msg); this.broadcastLobby(); break;
      case 'fillAI': room.fillWithAI(s.token, msg.level); this.broadcastLobby(); break;
      case 'lakes': room.rerollLakes(s.token); break;
      case 'setup': room.submitSetup(s.token, msg.placements); break;
      case 'unready': room.unready(s.token); break;
      case 'resign': event = room.resign(s.token); break;
      case 'rematch': room.rematch(s.token); break;
      case 'move': event = room.move(s.token, msg.from, msg.to); break;
      default: throw new GameError('Unknown message');
    }
    return this.changed(room, event);
  }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create(s, options) {
    if (this.roomOf(s)) throw new GameError('You are already in a game');
    const room = new Room(this.newCode(), options);
    room.addPlayer(s.token, s.name);
    this.rooms.set(room.code, room);
    s.roomCode = room.code;
    this.log(`game ${room.code} opened by ${s.name} (${room.mode} ${room.size}, ${room.seats.length} seats)`);
    this.changed(room);
    this.broadcastLobby();
  }

  join(s, code) {
    if (this.roomOf(s)) throw new GameError('You are already in a game');
    const room = this.rooms.get(String(code ?? '').trim().toUpperCase());
    if (!room) throw new GameError('No game with that code');
    room.addPlayer(s.token, s.name);
    s.roomCode = room.code;
    this.log(`${s.name} joined game ${room.code}`);
    this.changed(room);
    this.broadcastLobby();
  }

  removeFromRoom(room, s, reason) {
    const { empty, event } = room.leave(s.token, reason);
    s.roomCode = null;
    clearTimeout(s.dropTimer);
    if (empty) this.deleteRoom(room);
    else this.changed(room, event);
    this.broadcastLobby();
  }

  deleteRoom(room) {
    clearTimeout(room.aiTimer);
    this.rooms.delete(room.code);
  }

  // ---- outgoing -------------------------------------------------------------------------------
  /** Tells everyone in the room what changed and, if it is a computer player's turn, lets it think. */
  changed(room, event = null) {
    this.sendState(room, event);
    this.driveAI(room);
  }

  /** Sends every person in the room their own view (plus the masked event that caused the change, if any). */
  sendState(room, event = null) {
    for (const seat of room.humans()) {
      const s = this.sessions.get(seat.token);
      if (!s || s.roomCode !== room.code) continue;
      this.send(s, { t: 'state', view: room.view(seat.token), event: room.maskEvent(event, seat.token) });
    }
  }

  /** Plays computer seats, one move at a time, with a short pause so people can follow. */
  driveAI(room) {
    clearTimeout(room.aiTimer);
    room.aiTimer = null;
    if (!room.aiToMove()) return;
    // once every person is out of the game the rest is only for show, so it goes faster
    const watching = room.humans().some((h) => !h.left && room.state.alive[h.color]);
    room.aiTimer = setTimeout(() => {
      room.aiTimer = null;
      if (!this.rooms.has(room.code) || !room.aiToMove()) return;
      try {
        this.changed(room, room.aiMove(this.aiOptions));
      } catch (e) {
        this.log('computer player failed', e);
      }
    }, watching ? this.aiDelayMs : Math.min(this.aiDelayMs, 250));
    room.aiTimer.unref?.();
  }

  lobbyMessage() {
    const rooms = [...this.rooms.values()]
      .filter((r) => r.phase === 'waiting' && r.openSeats().length)
      .map((r) => {
        const host = r.humans().find((h) => r.isHost(h));
        return {
          code: r.code, host: host ? host.name : '', mode: r.mode, size: r.size, players: r.seats.length,
          open: r.openSeats().length, ai: r.seats.filter((x) => x.type === 'ai').length,
        };
      });
    return { t: 'lobby', rooms };
  }

  broadcastLobby() {
    const msg = this.lobbyMessage();
    for (const s of this.sessions.values()) if (!s.roomCode) this.send(s, msg);
  }

  close() {
    for (const s of this.sessions.values()) clearTimeout(s.dropTimer);
    for (const r of this.rooms.values()) clearTimeout(r.aiTimer);
  }
}
