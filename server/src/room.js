// One Stratego game between two players. Pure logic (no sockets): the lobby feeds it messages and
// ships out the per-player views. The rules engine is shared with the single-player game.
import {
  SIZES, makeConfig, armyTotal, territory, createState, legalMoves, applyMove, enemyOf, rowOf,
} from '../../single/web/src/game.js';

export class GameError extends Error {}

export const PHASE = { WAITING: 'waiting', SETUP: 'setup', PLAY: 'play', OVER: 'over' };

const isInt = (v) => Number.isInteger(v);

/** Checks a full army placement for `color`; returns a clean {index: rank} object or throws. */
export function validateSetup(placements, color, cfg) {
  if (!placements || typeof placements !== 'object' || Array.isArray(placements)) throw new GameError('Invalid setup');
  const n = cfg.size;
  const rows = new Set(territory(color, n));
  const counts = {};
  const clean = {};
  for (const [key, rank] of Object.entries(placements)) {
    const i = Number(key);
    if (!isInt(i) || i < 0 || i >= n * n) throw new GameError('Square out of range');
    if (!rows.has(rowOf(i, n)) || cfg.lakes[i]) throw new GameError('Pieces must be placed in your own territory');
    if (!isInt(rank) || rank < 0 || rank > 11) throw new GameError('Unknown piece');
    clean[i] = rank;
    counts[rank] = (counts[rank] || 0) + 1;
  }
  if (Object.keys(clean).length !== armyTotal(cfg.army)) throw new GameError('Place all of your pieces first');
  for (const [rank, k] of Object.entries(cfg.army)) {
    if ((counts[rank] || 0) !== k) throw new GameError('That is not the right army for this board');
  }
  return clean;
}

export class Room {
  constructor(code, size) {
    if (!SIZES.includes(size)) throw new GameError('Unsupported board size');
    this.code = code;
    this.cfg = makeConfig(size);
    this.players = []; // players[0] is the host (the creator)
    this.phase = PHASE.WAITING;
    this.state = null; // engine state, only during play/over
    this.result = null; // {winner: color, reason: 'flag'|'blocked'|'resigned'|'abandoned'|'left'}
    this.seq = 0;
  }

  find(token) {
    const p = this.players.find((x) => x.token === token);
    if (!p) throw new GameError('You are not in this game');
    return p;
  }
  opponentOf(p) { return this.players.find((x) => x !== p) || null; }
  active() { return this.players.filter((p) => !p.left); }

  addPlayer(token, name) {
    if (this.phase !== PHASE.WAITING || this.players.length >= 2) throw new GameError('That game is not open');
    this.players.push({ token, name, color: null, connected: true, ready: false, setup: null, rematch: false, left: false });
    if (this.players.length === 2) {
      const flip = Math.random() < 0.5;
      this.players[0].color = flip ? 'red' : 'blue';
      this.players[1].color = flip ? 'blue' : 'red';
      this.phase = PHASE.SETUP;
    }
  }

  setConnected(token, connected) {
    const p = this.players.find((x) => x.token === token);
    if (p) p.connected = connected;
  }

  /** Host re-rolls the lakes of a large board before the game starts. */
  rerollLakes(token) {
    const p = this.find(token);
    if (p !== this.players[0]) throw new GameError('Only the host can change the lakes');
    if (this.cfg.size <= 10) throw new GameError('The classic board has fixed lakes');
    if (this.phase !== PHASE.WAITING && this.phase !== PHASE.SETUP) throw new GameError('The game has already started');
    this.cfg = makeConfig(this.cfg.size);
    for (const x of this.players) { x.ready = false; }
  }

  submitSetup(token, placements) {
    const p = this.find(token);
    if (this.phase !== PHASE.SETUP) throw new GameError('Not in setup');
    p.setup = validateSetup(placements, p.color, this.cfg);
    p.ready = true;
    const [a, b] = this.players;
    if (a.ready && b.ready) {
      const red = a.color === 'red' ? a : b, blue = a.color === 'red' ? b : a;
      this.state = createState(red.setup, blue.setup, this.cfg);
      this.phase = PHASE.PLAY;
    }
  }

  unready(token) {
    const p = this.find(token);
    if (this.phase === PHASE.SETUP) p.ready = false;
  }

  /** Applies a move for the player whose turn it is. Returns the engine event. */
  move(token, from, to) {
    const p = this.find(token);
    if (this.phase !== PHASE.PLAY) throw new GameError('The game is not in progress');
    if (this.state.turn !== p.color) throw new GameError('It is not your turn');
    if (!isInt(from) || !isInt(to) || !legalMoves(this.state, p.color, from).some((m) => m.to === to)) throw new GameError('Illegal move');
    const { state, event } = applyMove(this.state, { from, to });
    this.state = state;
    this.seq++;
    if (state.winner) { this.result = { winner: state.winner, reason: state.winReason }; this.phase = PHASE.OVER; }
    return event;
  }

  finish(winner, reason) {
    this.result = { winner, reason };
    this.phase = PHASE.OVER;
  }

  resign(token) {
    const p = this.find(token);
    if (this.phase !== PHASE.PLAY) throw new GameError('The game is not in progress');
    this.finish(enemyOf(p.color), 'resigned');
  }

  /**
   * Removes a player from the room (they left, or were away too long). Mid-game this forfeits the game and keeps
   * the other player in an "over" room; otherwise the remaining player (if any) goes back to waiting for an opponent.
   * Returns true when nobody is left and the room should be deleted.
   */
  leave(token, reason = 'left') {
    const p = this.find(token);
    if (this.phase === PHASE.PLAY) {
      p.left = true;
      this.finish(enemyOf(p.color), reason);
      return false;
    }
    this.players = this.players.filter((x) => x !== p);
    const remaining = this.active();
    if (!remaining.length) return true;
    this.players = remaining;
    this.phase = PHASE.WAITING;
    this.state = null;
    this.result = null;
    for (const x of this.players) Object.assign(x, { color: null, ready: false, setup: null, rematch: false });
    return false;
  }

  /** After a finished game both players must agree to play again; sides are swapped. */
  rematch(token) {
    const p = this.find(token);
    const opp = this.opponentOf(p);
    if (this.phase !== PHASE.OVER || !opp || opp.left) throw new GameError('No rematch is possible');
    p.rematch = true;
    if (opp.rematch) {
      for (const x of this.players) Object.assign(x, { color: enemyOf(x.color), ready: false, setup: null, rematch: false });
      this.state = null;
      this.result = null;
      this.phase = PHASE.SETUP;
    }
  }

  /** What `color` may know about an engine event. A quiet move hides the mover's rank unless it revealed itself. */
  maskEvent(event, color) {
    if (!event) return null;
    const e = { ...event, mine: event.owner === color };
    delete e.owner;
    if (e.type === 'move' && !e.mine && e.dist <= 1) delete e.attacker;
    return e;
  }

  /** Everything `token`'s player is allowed to see. Opponent ranks are only present once revealed. */
  view(token) {
    const me = this.find(token);
    const opp = this.opponentOf(me);
    const color = me.color;
    const n = this.cfg.size;
    const v = {
      code: this.code,
      phase: this.phase,
      size: n,
      lakes: this.cfg.lakes.flatMap((l, i) => (l ? [i] : [])),
      army: this.cfg.army,
      you: color,
      host: me === this.players[0],
      me: { name: me.name, ready: me.ready, connected: me.connected },
      opp: opp ? { name: opp.name, ready: opp.ready, connected: opp.connected, left: opp.left } : null,
      rematch: { me: me.rematch, opp: !!opp && opp.rematch },
      mySetup: this.phase === PHASE.SETUP && me.setup ? me.setup : null,
      seq: this.seq,
    };
    if (this.phase === PHASE.PLAY || this.phase === PHASE.OVER) {
      const s = this.state;
      const revealAll = this.phase === PHASE.OVER;
      v.board = s.board.map((p) => (p ? {
        o: p.owner === color ? 'me' : 'opp',
        r: p.owner === color || p.revealed || revealAll ? p.rank : null,
        v: p.revealed,
        m: p.moved,
      } : null));
      v.turn = s.turn === color ? 'me' : 'opp';
      v.dead = { me: s.dead[color], opp: s.dead[enemyOf(color)] };
      v.lastMove = s.lastMove;
      v.moves = this.phase === PHASE.PLAY && s.turn === color ? legalMoves(s, color).map((m) => [m.from, m.to]) : [];
      v.result = this.result ? { winner: this.result.winner === color ? 'me' : 'opp', reason: this.result.reason } : null;
    }
    return v;
  }
}
