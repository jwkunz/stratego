// One Stratego game with two to six seats. Pure logic (no sockets): the lobby feeds it messages, ships out the
// per-player views and drives the computer seats. The rules engine and the AI are shared with the single-player game.
//
// A seat is a human, a computer, or still open. The host (who created the room) decides the number of computer seats
// and the teams while the room is waiting. When every seat is taken the players set up their armies at the same time
// (computer seats set up by themselves); when everyone is ready the game starts and the turns go around the table.
import {
  SIZES, makeConfig, makeHexConfig, rerollHexLakes, randomSetupFor, createStateN, legalMoves, applyMove, forfeit,
  armyTotal,
} from '../../single/web/src/game.js';
import { HEX_SIZES, HEX_PLAYERS } from '../../single/web/src/topology.js';
import { pickMove, DIFFICULTIES } from '../../single/web/src/ai.js';

export class GameError extends Error {}

export const PHASE = { WAITING: 'waiting', SETUP: 'setup', PLAY: 'play', OVER: 'over' };
export const TEAM_LABELS = ['A', 'B', 'C'];

const isInt = (v) => Number.isInteger(v);

/** Checks a full army placement for `color`; returns a clean {cell: rank} object or throws. */
export function validateSetup(placements, color, cfg) {
  if (!placements || typeof placements !== 'object' || Array.isArray(placements)) throw new GameError('Invalid setup');
  const zone = new Set(cfg.topo.zones[color]);
  const counts = {};
  const clean = {};
  for (const [key, rank] of Object.entries(placements)) {
    const i = Number(key);
    if (!isInt(i) || i < 0 || i >= cfg.topo.cells) throw new GameError('Square out of range');
    if (!zone.has(i) || cfg.topo.lakes[i]) throw new GameError('Pieces must be placed in your own territory');
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

/** Validates the options of a `create` message. Classic square games are always 2 players. */
export function parseOptions(o = {}) {
  const mode = o.mode === 'hex' ? 'hex' : 'square';
  let size, players;
  if (mode === 'square') {
    size = Number(o.size ?? 10);
    if (!SIZES.includes(size)) throw new GameError('Unsupported board size');
    players = 2;
  } else {
    size = String(o.size ?? 'medium');
    if (!(size in HEX_SIZES)) throw new GameError('Unsupported board size');
    players = Number(o.players ?? 3);
    if (!HEX_PLAYERS.includes(players)) throw new GameError('Hexagon games have 2 to 6 players');
  }
  const ai = Number(o.ai ?? 0);
  if (!isInt(ai) || ai < 0 || ai > players - 1) throw new GameError('Keep at least one human seat for yourself');
  const level = o.level === undefined ? 'medium' : o.level;
  if (!DIFFICULTIES.includes(level)) throw new GameError('Unknown difficulty');
  let teams = null;
  if (o.teams !== undefined && o.teams !== null) {
    if (mode === 'square' || !Array.isArray(o.teams) || o.teams.length > players) throw new GameError('Invalid teams');
    teams = o.teams.map((t) => { if (t && !TEAM_LABELS.includes(t)) throw new GameError('Invalid teams'); return t || ''; });
  }
  return { mode, size, players, ai, level, teams };
}

export class Room {
  constructor(code, options) {
    const o = parseOptions(options);
    this.code = code;
    this.mode = o.mode;
    this.size = o.size;
    this.cfg = o.mode === 'hex' ? makeHexConfig({ a: HEX_SIZES[o.size], players: o.players }) : makeConfig(o.size);
    this.seats = this.cfg.players.map((color, seat) => ({
      seat, color, type: 'open', token: null, name: '', level: o.level, team: (o.teams && o.teams[seat]) || '',
      connected: false, ready: false, setup: null, rematch: false, left: false,
    }));
    for (let k = 0; k < o.ai; k++) { const s = this.seats[this.seats.length - 1 - k]; s.type = 'ai'; s.name = this.aiName(s.seat); }
    this.checkTeams();
    this.hostToken = null;
    this.firstSeat = 0;
    this.phase = PHASE.WAITING;
    this.state = null; // engine state, only during play/over
    this.result = null; // {winners: [colors], winner: color, reason}
    this.seq = 0;
    this.aiTimer = null;
  }

  // ---- seats ----------------------------------------------------------------------------------
  aiName(seat) { return this.seats && this.seats.length > 2 ? `Computer ${seat + 1}` : 'Computer'; }
  humans() { return this.seats.filter((s) => s.type === 'human'); }
  seatOf(token) {
    const s = this.seats.find((x) => x.type === 'human' && x.token === token);
    if (!s) throw new GameError('You are not in this game');
    return s;
  }
  hasToken(token) { return this.seats.some((x) => x.type === 'human' && x.token === token); }
  isHost(seat) { return seat.token === this.hostToken; }
  openSeats() { return this.seats.filter((s) => s.type === 'open'); }
  /** Everyone's team; people without one play for themselves. */
  teamMap() { return Object.fromEntries(this.seats.map((s) => [s.color, s.team || s.color])); }
  checkTeams() {
    if (new Set(Object.values(this.teamMap())).size < 2) throw new GameError('Put at least two sides against each other');
  }
  /** Humans who still take part: seated and not gone. */
  active() { return this.humans().filter((s) => !s.left); }

  addPlayer(token, name) {
    if (this.phase !== PHASE.WAITING) throw new GameError('That game is not open');
    if (this.hasToken(token)) throw new GameError('You are already in this game');
    const seat = this.openSeats()[0];
    if (!seat) throw new GameError('That game is full');
    Object.assign(seat, { type: 'human', token, name, connected: true, left: false });
    if (!this.hostToken) this.hostToken = token;
    this.maybeStartSetup();
  }

  /** Host only, while waiting: change a seat (computer or open, difficulty, team). */
  configureSeat(token, { seat: index, type, level, team }) {
    const me = this.seatOf(token);
    if (!this.isHost(me)) throw new GameError('Only the host can change the seats');
    if (this.phase !== PHASE.WAITING) throw new GameError('The game has already started');
    const seat = this.seats[index];
    if (!seat) throw new GameError('No such seat');
    const before = { ...seat };
    if (type !== undefined) {
      if (seat.type === 'human') throw new GameError('That seat is taken by a person');
      if (type !== 'ai' && type !== 'open') throw new GameError('Unknown seat type');
      seat.type = type;
      seat.name = type === 'ai' ? this.aiName(seat.seat) : '';
    }
    if (level !== undefined) {
      if (!DIFFICULTIES.includes(level)) throw new GameError('Unknown difficulty');
      seat.level = level;
    }
    if (team !== undefined) {
      if (this.mode === 'square') throw new GameError('The classic board has no teams');
      if (team && !TEAM_LABELS.includes(team)) throw new GameError('Unknown team');
      seat.team = team || '';
    }
    try { this.checkTeams(); } catch (e) { Object.assign(seat, before); throw e; }
    this.maybeStartSetup();
  }

  /** Host only: every open seat becomes a computer player. */
  fillWithAI(token, level = 'medium') {
    const me = this.seatOf(token);
    if (!this.isHost(me)) throw new GameError('Only the host can change the seats');
    if (this.phase !== PHASE.WAITING) throw new GameError('The game has already started');
    if (!DIFFICULTIES.includes(level)) throw new GameError('Unknown difficulty');
    for (const s of this.openSeats()) Object.assign(s, { type: 'ai', level, name: this.aiName(s.seat) });
    this.maybeStartSetup();
  }

  /** Host re-rolls the lakes of a hexagon or large square board before the game starts. */
  rerollLakes(token) {
    const me = this.seatOf(token);
    if (!this.isHost(me)) throw new GameError('Only the host can change the lakes');
    if (this.phase !== PHASE.WAITING && this.phase !== PHASE.SETUP) throw new GameError('The game has already started');
    if (this.mode === 'square') {
      if (this.size <= 10) throw new GameError('The classic board has fixed lakes');
      this.cfg = makeConfig(this.size);
    } else {
      this.cfg = rerollHexLakes(this.cfg);
    }
    for (const s of this.humans()) s.ready = false;
  }

  // ---- phases ---------------------------------------------------------------------------------
  maybeStartSetup() {
    if (this.phase === PHASE.WAITING && !this.openSeats().length) this.startSetup({ flip: true });
  }

  /** Everyone is seated: on to setup. `flip`: for the classic board, a coin flip decides who is red (and moves first). */
  startSetup({ flip = false } = {}) {
    this.cfg = { ...this.cfg, teams: this.teamMap() };
    if (flip && this.mode === 'square' && Math.random() < 0.5) this.swapSeats(0, 1);
    this.phase = PHASE.SETUP;
    this.state = null;
    this.result = null;
    for (const s of this.seats) {
      s.rematch = false;
      if (s.type === 'ai') { s.setup = randomSetupFor(this.cfg, s.color); s.ready = true; } else { s.setup = null; s.ready = false; }
    }
    this.checkPlay();
  }

  /** Swaps who sits where (colours and positions stay with the seat). */
  swapSeats(i, j) {
    const keys = ['type', 'token', 'name', 'level', 'connected', 'left'];
    const a = this.seats[i], b = this.seats[j];
    for (const k of keys) { const t = a[k]; a[k] = b[k]; b[k] = t; }
  }

  submitSetup(token, placements) {
    const seat = this.seatOf(token);
    if (this.phase !== PHASE.SETUP) throw new GameError('Not in setup');
    seat.setup = validateSetup(placements, seat.color, this.cfg);
    seat.ready = true;
    this.checkPlay();
  }

  unready(token) {
    const seat = this.seatOf(token);
    if (this.phase === PHASE.SETUP) seat.ready = false;
  }

  checkPlay() {
    if (this.phase !== PHASE.SETUP) return;
    if (!this.seats.every((s) => s.ready || s.left)) return;
    const setups = Object.fromEntries(this.seats.map((s) => [s.color, s.setup || {}]));
    this.state = createStateN(setups, this.cfg, { first: this.seats[this.firstSeat].color });
    this.phase = PHASE.PLAY;
  }

  // ---- play -----------------------------------------------------------------------------------
  afterEngine() {
    this.seq++;
    const s = this.state;
    if (s.winner && this.phase === PHASE.PLAY) {
      this.result = { winners: s.winners, winner: s.winner, reason: s.winReason };
      this.phase = PHASE.OVER;
    }
  }

  applyEngineMove(move) {
    const { state, event } = applyMove(this.state, move);
    this.state = state;
    this.afterEngine();
    return event;
  }

  /** A human plays a move. Returns the engine event. */
  move(token, from, to) {
    const seat = this.seatOf(token);
    if (this.phase !== PHASE.PLAY) throw new GameError('The game is not in progress');
    if (this.state.turn !== seat.color) throw new GameError('It is not your turn');
    if (!isInt(from) || !isInt(to) || !legalMoves(this.state, seat.color, from).some((m) => m.to === to)) throw new GameError('Illegal move');
    return this.applyEngineMove({ from, to });
  }

  /** The computer seat whose turn it is, if any. */
  aiToMove() {
    if (this.phase !== PHASE.PLAY) return null;
    const seat = this.seats.find((s) => s.color === this.state.turn);
    return seat && seat.type === 'ai' ? seat : null;
  }

  /** The computer seat whose turn it is plays. Returns the engine event. */
  aiMove(opts = {}) {
    const seat = this.aiToMove();
    if (!seat) throw new GameError('No computer player to move');
    const move = pickMove(this.state, seat.color, seat.level, opts);
    if (!move) throw new GameError('The computer player has no move');
    return this.applyEngineMove(move);
  }

  /** A seat drops out of a running game (resigned, left, or disconnected for too long). */
  forfeitSeat(seat, reason) {
    const { state, eliminated } = forfeit(this.state, seat.color, reason);
    this.state = state;
    this.afterEngine();
    return { type: 'out', owner: seat.color, reason, eliminated };
  }

  resign(token) {
    const seat = this.seatOf(token);
    if (this.phase !== PHASE.PLAY) throw new GameError('The game is not in progress');
    if (!this.state.alive[seat.color]) throw new GameError('You are already out');
    return this.forfeitSeat(seat, 'resigned');
  }

  setConnected(token, connected) {
    const s = this.seats.find((x) => x.type === 'human' && x.token === token);
    if (s) s.connected = connected;
  }

  /**
   * A person leaves (or was away too long). During a game they are knocked out and the game goes on without them;
   * before the game starts their seat opens up again. Returns { empty, event }: `empty` means no person is left in the room.
   */
  leave(token, reason = 'left') {
    const seat = this.seatOf(token);
    let event = null;
    if (this.phase === PHASE.PLAY) {
      seat.left = true; seat.connected = false;
      event = this.forfeitSeat(seat, reason);
    } else if (this.phase === PHASE.OVER) {
      seat.left = true; seat.connected = false;
    } else {
      const wasHost = this.isHost(seat);
      Object.assign(seat, { type: 'open', token: null, name: '', connected: false, ready: false, setup: null, left: false, rematch: false });
      if (wasHost) this.hostToken = (this.humans()[0] || {}).token || null;
      if (this.phase === PHASE.SETUP) this.backToWaiting();
    }
    return { empty: this.active().length === 0, event };
  }

  backToWaiting() {
    this.phase = PHASE.WAITING;
    this.state = null;
    this.result = null;
    for (const s of this.seats) { s.ready = false; s.setup = null; s.rematch = false; }
  }

  /** After a finished game everyone has to agree; the classic board swaps colours, hexagon games rotate who starts. */
  rematch(token) {
    const seat = this.seatOf(token);
    if (this.phase !== PHASE.OVER || this.humans().some((s) => s.left)) throw new GameError('No rematch is possible');
    seat.rematch = true;
    if (!this.humans().every((s) => s.rematch)) return;
    if (this.mode === 'square') this.swapSeats(0, 1); else this.firstSeat = (this.firstSeat + 1) % this.seats.length;
    this.startSetup();
  }

  // ---- what each player may see --------------------------------------------------------------------
  /** What `token`'s player may know about an engine event. A quiet move hides the mover's rank unless they are a teammate. */
  maskEvent(event, token) {
    if (!event) return null;
    const me = this.seatOf(token);
    const e = { ...event, mine: event.owner === me.color };
    if (e.type === 'move' && !e.mine && e.dist <= 1 && this.state.teams[event.owner] !== this.state.teams[me.color]) delete e.attacker;
    return e;
  }

  /** Everything `token`'s player is allowed to see. Other people's ranks are only present once revealed (or for teammates). */
  view(token) {
    const me = this.seatOf(token);
    const s = this.state;
    const v = {
      code: this.code,
      phase: this.phase,
      mode: this.mode,
      size: this.mode === 'square' ? this.size : null,
      hexSize: this.mode === 'hex' ? this.size : null,
      a: this.cfg.a || null,
      lakes: this.cfg.topo.lakes.flatMap((l, i) => (l ? [i] : [])),
      army: this.cfg.army,
      you: me.color,
      seat: me.seat,
      host: this.isHost(me),
      players: this.seats.map((x) => ({
        seat: x.seat, color: x.color, type: x.type, name: x.name, level: x.type === 'ai' || x.type === 'open' ? x.level : null,
        team: x.team || null, connected: x.type === 'ai' ? true : x.connected, ready: x.ready, left: x.left, rematch: x.rematch,
        alive: s ? s.alive[x.color] : true, out: s && !s.alive[x.color] ? s.outReason[x.color] : null, isMe: x === me,
      })),
      mySetup: this.phase === PHASE.SETUP && me.setup ? me.setup : null,
      seq: this.seq,
    };
    if (this.phase === PHASE.PLAY || this.phase === PHASE.OVER) {
      const revealAll = this.phase === PHASE.OVER;
      const myTeam = s.teams[me.color];
      v.board = s.board.map((p) => (p ? {
        o: p.owner,
        r: revealAll || p.revealed || s.teams[p.owner] === myTeam ? p.rank : null,
        v: p.revealed,
        m: p.moved,
      } : null));
      v.turn = this.phase === PHASE.PLAY ? s.turn : null;
      v.dead = s.dead;
      v.lastMove = s.lastMove;
      v.moves = this.phase === PHASE.PLAY && s.turn === me.color ? legalMoves(s, me.color).map((m) => [m.from, m.to]) : [];
      v.result = this.result ? { ...this.result, won: this.result.winners.includes(me.color) } : null;
    }
    return v;
  }
}
