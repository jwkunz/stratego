// Core Stratego rules. Pure functions, no DOM.
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
/** Rows of a player's starting territory, back row first. */
export const territory = (owner, n = SIZE) => {
  const d = depthFor(n);
  return owner === 'red' ? Array.from({ length: d }, (_, k) => n - 1 - k) : Array.from({ length: d }, (_, k) => k);
};

/** Army composition for a board size: the classic mix scaled to fill the starting zone. */
export function armyFor(n) {
  if (n === SIZE) return { ...INITIAL };
  const total = n * depthFor(n);
  const k = total / 40;
  const army = {};
  for (const r of Object.keys(INITIAL)) army[r] = Math.max(1, Math.round(INITIAL[r] * k));
  army[FLAG] = 1;
  army[SCOUT] += total - Object.values(army).reduce((a, b) => a + b, 0);
  return army;
}
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

/** A board configuration: size, lake map and army composition. */
export function makeConfig(size = SIZE, lakes = null) {
  return { size, lakes: lakes || (size === SIZE ? classicLakes() : randomLakes(size)), army: armyFor(size) };
}

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

let nextId = 1;
export function createState(redSetup, blueSetup, cfg = makeConfig(SIZE)) {
  const board = Array(cfg.size * cfg.size).fill(null);
  for (const [owner, setup] of [['red', redSetup], ['blue', blueSetup]]) {
    for (const [i, rank] of Object.entries(setup)) {
      board[i] = { id: nextId++, owner, rank, revealed: false, moved: false };
    }
  }
  return {
    size: cfg.size, lakes: cfg.lakes, army: cfg.army,
    board, turn: 'red', winner: null, winReason: null,
    shuttle: { red: null, blue: null },
    dead: { red: [], blue: [] },
    lastMove: null,
  };
}

/** Squares a piece at `from` can reach. Ignores the repetition rule. */
export function reachable(state, from) {
  const p = state.board[from];
  if (!p || !canMove(p.rank)) return [];
  const out = [];
  const n = state.size;
  const r0 = rowOf(from, n), c0 = colOf(from, n);
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < n && c >= 0 && c < n && !state.lakes[idx(r, c, n)]) {
      const t = state.board[idx(r, c, n)];
      if (t) { if (t.owner !== p.owner) out.push(idx(r, c, n)); break; }
      out.push(idx(r, c, n));
      if (p.rank !== SCOUT) break;
      r += dr; c += dc;
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

/** Outcome from the attacker's view: 'win' | 'lose' | 'tie'. */
export function resolve(a, d) {
  if (d === FLAG) return 'win';
  if (d === BOMB) return a === MINER ? 'win' : 'lose';
  if (a === SPY && d === MARSHAL) return 'win';
  return a > d ? 'win' : a < d ? 'lose' : 'tie';
}

/** Applies a (legal) move. Returns {state, event}; the input state is not mutated. */
export function applyMove(state, move) {
  const board = state.board.slice();
  const mover = board[move.from];
  const owner = mover.owner;
  const target = board[move.to];
  const n = state.size;
  const dist = Math.abs(rowOf(move.to, n) - rowOf(move.from, n)) + Math.abs(colOf(move.to, n) - colOf(move.from, n));
  const dead = { red: state.dead.red.slice(), blue: state.dead.blue.slice() };
  const att = { ...mover, moved: true, revealed: mover.revealed || dist > 1 };
  const event = { type: 'move', owner, from: move.from, to: move.to, attacker: mover.rank, dist };
  let winner = null, winReason = null;
  board[move.from] = null;

  if (!target) {
    board[move.to] = att;
  } else {
    att.revealed = true;
    const def = { ...target, revealed: true };
    const result = resolve(att.rank, def.rank);
    Object.assign(event, { type: 'attack', defender: def.rank, result });
    if (result === 'win') {
      board[move.to] = att; dead[def.owner].push(def.rank);
      if (def.rank === FLAG) { winner = owner; winReason = 'flag'; }
    } else if (result === 'lose') {
      board[move.to] = def; dead[owner].push(att.rank);
    } else {
      board[move.to] = null; dead[owner].push(att.rank); dead[def.owner].push(def.rank);
    }
  }

  const prev = state.shuttle[owner];
  const shuttle = { ...state.shuttle };
  shuttle[owner] = target ? null
    : prev && prev.from === move.to && prev.to === move.from
      ? { from: move.from, to: move.to, count: prev.count + 1 }
      : { from: move.from, to: move.to, count: 1 };

  const next = { ...state, board, dead, shuttle, turn: enemyOf(owner), winner, winReason, lastMove: move };
  if (!winner && legalMoves(next, next.turn).length === 0) {
    next.winner = owner; next.winReason = 'blocked';
  }
  return { state: next, event };
}
