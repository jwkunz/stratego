// Core Stratego rules. Pure functions, no DOM.
// The board is a topology (see topology.js: square grid or hexagon star) and any number of players (2-6) can take part,
// alone or in teams. The classic two-player square game (players 'red' and 'blue') is just one configuration.
import { squareTopology, hexTopology, applyLakes, randomHexTopology } from './topology.js';

export const SIZE = 10;
export const FLAG = 0, SPY = 1, SCOUT = 2, MINER = 3, MARSHAL = 10, BOMB = 11;
export const INITIAL = { 0: 1, 1: 1, 2: 8, 3: 5, 4: 4, 5: 4, 6: 4, 7: 3, 8: 2, 9: 1, 10: 1, 11: 6 };
export const NAMES = ['Flag', 'Spy', 'Scout', 'Miner', 'Sergeant', 'Lieutenant', 'Captain', 'Major', 'Colonel', 'General', 'Marshal', 'Bomb'];
export const RANK_ORDER = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 11];

export const SIZES = [10, 12, 16, 20];
/** How many rows deep each side's starting zone is. */
export const depthFor = (n) => (n <= 12 ? 4 : n <= 16 ? 5 : 6);
export const rowOf = (i, n = SIZE) => Math.floor(i / n);
export const colOf = (i, n = SIZE) => i % n;
export const idx = (r, c, n = SIZE) => r * n + c;
export const enemyOf = (p) => (p === 'red' ? 'blue' : 'red');
/** Classic 10x10 lake squares. */
export const isLake = (r, c) => (r === 4 || r === 5) && (c === 2 || c === 3 || c === 6 || c === 7);
export const canMove = (rank) => rank >= SPY && rank <= MARSHAL;
/** Points a piece is worth when lost: its rank (Spy 1 ... Marshal 10). Bombs and the flag are not scored. */
export const pieceScore = (rank) => (canMove(rank) ? rank : 0);
export const totalScore = (ranks) => ranks.reduce((sum, r) => sum + pieceScore(r), 0);
/** Points in a whole army ({rank: count}); the material each side starts with. */
export const armyScore = (army) => Object.entries(army).reduce((sum, [r, n]) => sum + pieceScore(Number(r)) * n, 0);
/** Rows of a player's starting territory, back row first. */
export const territory = (owner, n = SIZE) => {
  const d = depthFor(n);
  return owner === 'red' ? Array.from({ length: d }, (_, k) => n - 1 - k) : Array.from({ length: d }, (_, k) => k);
};

/** The classic piece mix scaled to `total` pieces (one flag, every other kind at least once). */
function scaledArmy(total) {
  const k = total / 40;
  const army = {};
  for (const r of Object.keys(INITIAL)) army[r] = Math.max(1, Math.round(INITIAL[r] * k));
  army[FLAG] = 1;
  army[SCOUT] += total - Object.values(army).reduce((a, b) => a + b, 0);
  return army;
}

/** Army composition for a square board size: the classic mix scaled to fill the starting zone. */
export function armyFor(n) {
  if (n === SIZE) return { ...INITIAL };
  return scaledArmy(n * depthFor(n));
}
/** Army for a hex board whose camps have side `a` (a(a+1)/2 pieces, filling the camp exactly). */
export const hexArmy = (a) => scaledArmy((a * (a + 1)) / 2);
export const armyTotal = (army) => Object.values(army).reduce((a, b) => a + b, 0);

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Random lakes confined to the middle band, in 180-degree symmetric pairs, never splitting the board. */
export function randomLakes(n) {
  const top = depthFor(n), bottom = n - depthFor(n) - 1, bandH = bottom - top + 1;
  const near = (a, b) => a[0] <= b[2] + 1 && b[0] <= a[2] + 1 && a[1] <= b[3] + 1 && b[1] <= a[3] + 1;
  const connected = (lakes) => {
    const seen = new Set(), start = lakes.findIndex((l) => !l), stack = [start];
    seen.add(start);
    while (stack.length) {
      const i = stack.pop(), r = rowOf(i, n), c = colOf(i, n);
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nr = r + dr, nc = c + dc, j = idx(nr, nc, n);
        if (nr >= 0 && nr < n && nc >= 0 && nc < n && !lakes[j] && !seen.has(j)) { seen.add(j); stack.push(j); }
      }
    }
    return seen.size === lakes.filter((l) => !l).length;
  };
  const maxDim = Math.min(3, bandH - 1);
  let best = Array(n * n).fill(false);
  for (let attempt = 0; attempt < 50; attempt++) {
    const rects = [];
    let area = 0;
    for (let tries = 0; tries < 400 && area < 0.22 * n * bandH; tries++) {
      const h = 2 + Math.floor(Math.random() * (maxDim - 1)), w = 2 + Math.floor(Math.random() * 2);
      const r0 = top + Math.floor(Math.random() * (bandH - h + 1)), c0 = Math.floor(Math.random() * (n - w + 1));
      const a = [r0, c0, r0 + h - 1, c0 + w - 1];
      const b = [n - 1 - a[2], n - 1 - a[3], n - 1 - a[0], n - 1 - a[1]];
      const same = a.every((v, k) => v === b[k]);
      if (!same && near(a, b)) continue;
      if (rects.some((q) => near(a, q) || near(b, q))) continue;
      rects.push(a); area += h * w;
      if (!same) { rects.push(b); area += h * w; }
    }
    const lakes = Array(n * n).fill(false);
    for (const [r0, c0, r1, c1] of rects) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) lakes[idx(r, c, n)] = true;
    if (rects.length && connected(lakes)) return lakes;
    best = lakes;
  }
  return best.some((l) => l) && connected(best) ? best : Array(n * n).fill(false);
}

export const classicLakes = () => Array.from({ length: SIZE * SIZE }, (_, i) => isLake(rowOf(i), colOf(i)));

/** Team labels per player: an array (by seat) or object; players without a team are their own team. */
export function normalizeTeams(players, teams) {
  const out = {};
  players.forEach((p, seat) => {
    const t = Array.isArray(teams) ? teams[seat] : teams && teams[p];
    out[p] = t ? String(t) : p;
  });
  return out;
}

/** A square board configuration (always two players, red and blue): size, lake map, army and topology. */
export function makeConfig(size = SIZE, lakes = null) {
  const lk = lakes || (size === SIZE ? classicLakes() : randomLakes(size));
  const players = ['red', 'blue'];
  return {
    kind: 'square', size, lakes: lk, army: armyFor(size), topo: squareTopology(size, lk, depthFor(size)),
    players, teams: normalizeTeams(players, null),
  };
}

/**
 * A hexagon-star board configuration.
 * @param {object} o
 * @param {number} o.a        camp side / arena radius (6, 7 or 8)
 * @param {number} o.players  2..6; seats are red, blue, green, yellow, purple, orange in clockwise camp order
 * @param {Array|object} [o.teams]  team label per seat (array) or per player (object); omitted = everyone for themselves
 * @param {number[]} [o.lakes]      lake cell indices; omitted = freshly rolled symmetric lakes
 */
export function makeHexConfig({ a = 7, players = 3, teams = null, lakes = null } = {}) {
  const topo = lakes ? applyLakes(hexTopology({ a, players }), lakes) : randomHexTopology(a, players);
  return {
    kind: 'hex', a, size: null, lakes: topo.lakes, army: hexArmy(a), topo, players: topo.ids,
    teams: normalizeTeams(topo.ids, teams),
  };
}

/** The same hex board with new random lakes. */
export const rerollHexLakes = (cfg) => makeHexConfig({ a: cfg.a, players: cfg.players.length, teams: cfg.teams });

/** Squares/cells of a player's starting zone, back to front. */
export const zoneOf = (cfg, player) => cfg.topo.zones[player];

/** Returns {index: rank} for a full setup, loosely sensible. */
export function randomSetup(owner, n = SIZE) {
  const rows = territory(owner, n);
  const forward = owner === 'red' ? -1 : 1;
  const free = new Set();
  for (const r of rows) for (let c = 0; c < n; c++) free.add(idx(r, c, n));
  const placed = {};
  const put = (i, rank) => { placed[i] = rank; free.delete(i); };
  const counts = { ...armyFor(n) };

  const flagCol = Math.floor(Math.random() * n);
  put(idx(rows[0], flagCol, n), FLAG); counts[FLAG]--;
  const around = [];
  if (flagCol > 0) around.push(idx(rows[0], flagCol - 1, n));
  if (flagCol < n - 1) around.push(idx(rows[0], flagCol + 1, n));
  around.push(idx(rows[0] + forward, flagCol, n));
  for (const i of around) if (counts[BOMB] > 0 && Math.random() < 0.85) { put(i, BOMB); counts[BOMB]--; }
  const back = shuffle([...free].filter((i) => rows.slice(0, 2).includes(rowOf(i, n))));
  while (counts[BOMB] > 0) { put(back.pop(), BOMB); counts[BOMB]--; }

  const rest = [];
  for (const [rank, k] of Object.entries(counts)) for (let j = 0; j < k; j++) rest.push(Number(rank));
  shuffle(rest);
  for (const i of shuffle([...free])) put(i, rest.pop());
  return placed;
}

/** A loosely sensible full setup for a hex camp: flag in the back rows, bombs around it and behind the front. */
function randomSetupZone(topo, player, army) {
  const rows = topo.zoneRows[player];
  const rowOfCell = new Map();
  rows.forEach((row, j) => row.forEach((c) => rowOfCell.set(c, j)));
  const free = new Set(rows.flat());
  const placed = {};
  const put = (c, rank) => { placed[c] = rank; free.delete(c); };
  const counts = { ...army };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const flag = pick(rows.slice(0, 3).flat());
  put(flag, FLAG); counts[FLAG]--;
  for (let d = 0; d < topo.D; d++) {
    const c = topo.adj[flag * topo.D + d];
    if (c >= 0 && free.has(c) && rowOfCell.get(c) >= rowOfCell.get(flag) && counts[BOMB] > 0 && Math.random() < 0.85) { put(c, BOMB); counts[BOMB]--; }
  }
  const back = shuffle(rows.slice(0, Math.ceil(rows.length * 0.6)).flat().filter((c) => free.has(c)));
  while (counts[BOMB] > 0 && back.length) { put(back.pop(), BOMB); counts[BOMB]--; }

  const rest = [];
  for (const [rank, k] of Object.entries(counts)) for (let j = 0; j < k; j++) rest.push(Number(rank));
  shuffle(rest);
  for (const c of shuffle([...free])) put(c, rest.pop());
  return placed;
}

/** A random full setup for `player` on any configuration. */
export function randomSetupFor(cfg, player) {
  return cfg.topo.kind === 'square' ? randomSetup(player, cfg.size) : randomSetupZone(cfg.topo, player, cfg.army);
}

let nextId = 1;
/**
 * Starts a game. `setups` maps each player to {cell: rank}; the first player in `cfg.players` moves first.
 * State fields: topo, players, teams, alive, board, turn, winner/winners/winTeam/winReason, shuttle, dead, lastMove;
 * for compatibility with the square-only code, `size` (square boards) and `lakes` are kept too.
 */
export function createStateN(setups, cfg, { first = null } = {}) {
  const board = Array(cfg.topo.cells).fill(null);
  for (const owner of cfg.players) {
    for (const [i, rank] of Object.entries(setups[owner] || {})) {
      board[i] = { id: nextId++, owner, rank, revealed: false, moved: false };
    }
  }
  const each = (make) => Object.fromEntries(cfg.players.map((p) => [p, make()]));
  return {
    kind: cfg.kind, topo: cfg.topo, size: cfg.size, lakes: cfg.lakes, army: cfg.army,
    players: cfg.players, teams: cfg.teams, alive: each(() => true), outReason: {},
    board, turn: first && cfg.players.includes(first) ? first : cfg.players[0],
    winner: null, winners: [], winTeam: null, winReason: null,
    shuttle: each(() => null), dead: each(() => []),
    lastMove: null,
  };
}

/** The classic two-player start (red and blue). */
export function createState(redSetup, blueSetup, cfg = makeConfig(SIZE)) {
  return createStateN({ red: redSetup, blue: blueSetup }, cfg);
}

/** Cells a piece at `from` can reach (scouts slide any distance in a straight line). Ignores the repetition rule. */
export function reachable(state, from) {
  const p = state.board[from];
  if (!p || !canMove(p.rank)) return [];
  const { D, nbr } = state.topo;
  const team = state.teams[p.owner];
  const out = [];
  for (let d = 0; d < D; d++) {
    let c = nbr[from * D + d];
    while (c >= 0) {
      const t = state.board[c];
      if (t) { if (state.teams[t.owner] !== team) out.push(c); break; } // enemies can be attacked, allies block
      out.push(c);
      if (p.rank !== SCOUT) break;
      c = nbr[c * D + d];
    }
  }
  return out;
}

/** Two-square rule: the same piece may not shuttle between two squares more than 3 times in a row. */
function repeats(state, owner, from, to) {
  const s = state.shuttle[owner];
  return !!s && s.count >= 3 && s.from === to && s.to === from;
}

export function legalMoves(state, owner, fromOnly = null) {
  const moves = [];
  for (let i = 0; i < state.board.length; i++) {
    if (fromOnly !== null && i !== fromOnly) continue;
    const p = state.board[i];
    if (!p || p.owner !== owner) continue;
    for (const to of reachable(state, i)) if (!repeats(state, owner, i, to)) moves.push({ from: i, to });
  }
  return moves;
}

/** Cheaper than legalMoves(...).length > 0: stops at the first move found. */
export function hasLegalMove(state, owner) {
  for (let i = 0; i < state.board.length; i++) {
    const p = state.board[i];
    if (!p || p.owner !== owner) continue;
    for (const to of reachable(state, i)) if (!repeats(state, owner, i, to)) return true;
  }
  return false;
}

/** Outcome from the attacker's view: 'win' | 'lose' | 'tie'. */
export function resolve(a, d) {
  if (d === FLAG) return 'win';
  if (d === BOMB) return a === MINER ? 'win' : 'lose';
  if (a === SPY && d === MARSHAL) return 'win';
  return a > d ? 'win' : a < d ? 'lose' : 'tie';
}

/** The next player after `player` (in seat order) who is still in the game. */
export function nextAlive(state, player) {
  const { players } = state;
  const at = players.indexOf(player);
  for (let k = 1; k <= players.length; k++) {
    const p = players[(at + k) % players.length];
    if (state.alive[p]) return p;
  }
  return player;
}

export const sameTeam = (state, a, b) => state.teams[a] === state.teams[b];

/**
 * End-of-turn bookkeeping on a state that is being built (mutates `next`, whose board, alive and outReason are copies):
 * knocks out the `pending` players, removes their pieces unless that ends the game, hands the turn to the next player
 * who can move (players with no legal move are knocked out too), and declares the winners when one team is left.
 * `from` is the player who just moved (or the one who left); with `keepTurn` the turn stays with `next.turn` when
 * that player can still move, which is what a forfeit by somebody else needs.
 */
function settle(next, from, pending, eliminated, keepTurn) {
  const { board } = next;
  let lastReason = null;
  const eliminate = (player, reason) => {
    next.alive[player] = false; next.outReason[player] = reason; lastReason = reason;
    eliminated.push({ player, reason });
  };
  const aliveTeams = () => new Set(next.players.filter((p) => next.alive[p]).map((p) => next.teams[p]));
  const purge = (player) => { for (let i = 0; i < board.length; i++) if (board[i] && board[i].owner === player) board[i] = null; };

  for (const e of pending) eliminate(e.player, e.reason);
  let over = aliveTeams().size <= 1;
  if (!over) for (const e of pending) purge(e.player);

  let current = keepTurn && next.alive[next.turn] ? next.turn : nextAlive(next, from);
  while (!over) {
    if (hasLegalMove(next, current)) { next.turn = current; break; }
    eliminate(current, 'blocked');
    over = aliveTeams().size <= 1;
    if (!over) purge(current);
    current = nextAlive(next, current);
  }

  if (over) {
    const [team] = aliveTeams();
    next.winTeam = team;
    next.winners = next.players.filter((p) => next.teams[p] === team);
    next.winner = next.players.find((p) => next.alive[p] && next.teams[p] === team);
    next.winReason = lastReason;
    next.turn = next.players[(next.players.indexOf(from) + 1) % next.players.length];
  }
}

/**
 * A player leaves the game (resigns, quits or drops out): they are eliminated and their pieces leave the board.
 * Returns a new state; `eliminated` on the result lists everyone knocked out (the player, plus anybody left without a move).
 */
export function forfeit(state, player, reason = 'resigned') {
  if (state.winner || !state.alive[player]) return { state, eliminated: [] };
  const next = { ...state, board: state.board.slice(), alive: { ...state.alive }, outReason: { ...state.outReason } };
  const eliminated = [];
  settle(next, player, [{ player, reason }], eliminated, state.turn !== player);
  return { state: next, eliminated };
}

/**
 * Applies a (legal) move. Returns {state, event}; the input state is not mutated.
 * A player is eliminated when their flag is captured, or when they have no legal move on their turn; their pieces
 * leave the board (unless that ends the game, so the final position can still be shown). The game ends when only one
 * team has players left. `event.eliminated` lists everyone knocked out by this move.
 */
export function applyMove(state, move) {
  const board = state.board.slice();
  const mover = board[move.from];
  const owner = mover.owner;
  const target = board[move.to];
  const dist = state.topo.dist(move.from, move.to);
  const dead = { ...state.dead };
  const att = { ...mover, moved: true, revealed: mover.revealed || dist > 1 };
  const event = { type: 'move', owner, from: move.from, to: move.to, attacker: mover.rank, dist, eliminated: [] };
  const pending = [];
  board[move.from] = null;

  if (!target) {
    board[move.to] = att;
  } else {
    att.revealed = true;
    const def = { ...target, revealed: true };
    const result = resolve(att.rank, def.rank);
    Object.assign(event, { type: 'attack', defender: def.rank, defenderOwner: def.owner, result });
    if (result === 'win') {
      board[move.to] = att; dead[def.owner] = [...dead[def.owner], def.rank];
      if (def.rank === FLAG) pending.push({ player: def.owner, reason: 'flag' });
    } else if (result === 'lose') {
      board[move.to] = def; dead[owner] = [...dead[owner], att.rank];
    } else {
      board[move.to] = null; dead[owner] = [...dead[owner], att.rank]; dead[def.owner] = [...dead[def.owner], def.rank];
    }
  }

  const prev = state.shuttle[owner];
  const shuttle = { ...state.shuttle };
  shuttle[owner] = target ? null
    : prev && prev.from === move.to && prev.to === move.from
      ? { from: move.from, to: move.to, count: prev.count + 1 }
      : { from: move.from, to: move.to, count: 1 };

  const next = { ...state, board, dead, shuttle, lastMove: move, alive: { ...state.alive }, outReason: { ...state.outReason } };
  settle(next, owner, pending, event.eliminated, false);
  return { state: next, event };
}
