import { legalMoves, resolve, rowOf, colOf, idx, enemyOf, canMove, FLAG, BOMB, SCOUT } from './game.js';

export const DIFFICULTIES = ['easy', 'medium', 'hard'];

const VALUE = [1000, 30, 10, 25, 20, 30, 45, 60, 80, 100, 150, 40];

const LEVELS = {
  // Easy: noisy scoring, ignores danger, and sometimes just plays a random legal move.
  easy: { jitter: 25, blunder: 0.35, threats: false, search: false },
  // Medium: one-move lookahead using the odds of what each hidden piece is.
  medium: { jitter: 3, blunder: 0, threats: true, search: false },
  // Hard: medium's scoring picks candidates, then a few plies of search over sampled hidden pieces refine them.
  hard: { jitter: 1.5, blunder: 0, threats: true, search: true },
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function outcomeValue(a, d) {
  if (d === FLAG) return VALUE[FLAG];
  const r = resolve(a, d);
  if (r === 'win') return VALUE[d];
  if (r === 'tie') return VALUE[d] - VALUE[a];
  return -VALUE[a];
}

/** Rank distribution of the enemy pieces the AI has not seen yet. */
function unknownCounts(state, enemy) {
  const counts = { ...state.army };
  for (const r of state.dead[enemy]) counts[r]--;
  for (const p of state.board) if (p && p.owner === enemy && p.revealed) counts[p.rank]--;
  return counts;
}

function threatened(state, owner, at, rank) {
  const n = state.size;
  const r = rowOf(at, n), c = colOf(at, n);
  for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
    const q = state.board[idx(nr, nc, n)];
    if (q && q.owner !== owner && q.revealed && canMove(q.rank) && resolve(q.rank, rank) === 'win') return true;
  }
  return false;
}

/** One-move heuristic score for every move, using only what `owner` could legitimately know. */
function scoreMoves(state, owner, moves, level) {
  const enemy = enemyOf(owner);
  const counts = unknownCounts(state, enemy);
  const forward = owner === 'blue' ? 1 : -1;
  return moves.map((m) => {
    const me = state.board[m.from];
    const tgt = state.board[m.to];
    let score = Math.random() * level.jitter;
    if (tgt) {
      if (tgt.revealed) {
        score += outcomeValue(me.rank, tgt.rank);
      } else {
        const c = { ...counts };
        if (tgt.moved) { c[FLAG] = 0; c[BOMB] = 0; }
        let total = 0, ev = 0;
        for (const [d, k] of Object.entries(c)) { if (k > 0) { total += k; ev += k * outcomeValue(me.rank, Number(d)); } }
        score += total ? ev / total : 0;
        if (me.rank === SCOUT) score += 15; // scouting is worth the information
      }
    } else {
      const rows = (rowOf(m.to, state.size) - rowOf(m.from, state.size)) * forward;
      score += rows * (me.rank === SCOUT ? 0.5 : 2.5);
      if (level.threats) {
        if (threatened(state, owner, m.from, me.rank)) score += VALUE[me.rank] * 0.5;
        if (threatened(state, owner, m.to, me.rank)) score -= VALUE[me.rank] * 0.8;
      }
    }
    return score;
  });
}

// ---------------------------------------------------------------------------------------------
// Hard mode: determinized search. We repeatedly guess a plausible identity for every hidden enemy
// piece, run an alpha-beta search on that fully-known board, and average each candidate's result.
// ---------------------------------------------------------------------------------------------
const BIG = 100000;
const ME = 1, OPP = 2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

class Timeout extends Error {}

/** Builds a compact, fully-known board by randomly assigning ranks to the enemy's hidden pieces. */
function sampleWorld(state, owner, counts, lakes) {
  const n = state.size;
  const own = new Int8Array(n * n), rk = new Int8Array(n * n);
  const pool = [];
  for (const [rank, k] of Object.entries(counts)) for (let j = 0; j < k; j++) pool.push(Number(rank));
  shuffle(pool);
  const movable = pool.filter((r) => r !== FLAG && r !== BOMB);
  const fixed = pool.filter((r) => r === FLAG || r === BOMB);
  const movedIdx = [], restIdx = [];
  let mat = 0;
  state.board.forEach((p, i) => {
    if (!p) return;
    if (p.owner === owner) { own[i] = ME; rk[i] = p.rank; mat += VALUE[p.rank]; return; }
    own[i] = OPP;
    if (p.revealed) { rk[i] = p.rank; mat -= VALUE[p.rank]; } else (p.moved ? movedIdx : restIdx).push(i);
  });
  // Pieces that have moved cannot be flags or bombs.
  for (const i of movedIdx) { rk[i] = movable.length ? movable.pop() : (fixed.pop() ?? SCOUT); mat -= VALUE[rk[i]]; }
  const rest = shuffle(movable.concat(fixed));
  for (const i of restIdx) { rk[i] = rest.pop() ?? SCOUT; mat -= VALUE[rk[i]]; }
  return { n, own, rk, lakes, mat, winner: 0, nodes: 0, deadline: Infinity };
}

/** Legal moves for `side`, captures first (most valuable victims first). Scouts only try their first step and full slide. */
function gen(w, side, capsOnly) {
  const { n, own, rk, lakes } = w;
  const caps = [], quiet = [];
  for (let i = 0; i < n * n; i++) {
    if (own[i] !== side) continue;
    const r = rk[i];
    if (r < 1 || r > 10) continue;
    const r0 = (i / n) | 0, c0 = i % n;
    for (const [dr, dc] of DIRS) {
      let rr = r0 + dr, cc = c0 + dc, firstFree = -1, lastFree = -1;
      while (rr >= 0 && rr < n && cc >= 0 && cc < n) {
        const j = rr * n + cc;
        if (lakes[j]) break;
        const o = own[j];
        if (o === 0) {
          if (firstFree < 0) firstFree = j;
          lastFree = j;
        } else {
          if (o !== side) caps.push((i << 10) | j);
          break;
        }
        if (r !== SCOUT) break;
        rr += dr; cc += dc;
      }
      if (!capsOnly && firstFree >= 0) {
        quiet.push((i << 10) | firstFree);
        if (lastFree !== firstFree) quiet.push((i << 10) | lastFree);
      }
    }
  }
  caps.sort((a, b) => VALUE[rk[b & 1023]] - VALUE[rk[a & 1023]]);
  return capsOnly ? caps : caps.concat(quiet);
}

function applyS(w, m, side) {
  const from = m >> 10, to = m & 1023, { own, rk } = w;
  const u = [from, to, own[from], rk[from], own[to], rk[to], w.mat, w.winner];
  const a = rk[from];
  if (own[to] === 0) { own[to] = side; rk[to] = a; own[from] = 0; return u; }
  const d = rk[to], sg = side === ME ? 1 : -1, r = resolve(a, d);
  if (r === 'win') { own[to] = side; rk[to] = a; own[from] = 0; w.mat += sg * VALUE[d]; if (d === FLAG) w.winner = side; }
  else if (r === 'lose') { own[from] = 0; w.mat -= sg * VALUE[a]; }
  else { own[from] = 0; own[to] = 0; w.mat += sg * (VALUE[d] - VALUE[a]); }
  return u;
}

function undoS(w, u) {
  w.own[u[0]] = u[2]; w.rk[u[0]] = u[3]; w.own[u[1]] = u[4]; w.rk[u[1]] = u[5]; w.mat = u[6]; w.winner = u[7];
}

const tick = (w) => { if ((++w.nodes & 1023) === 0 && now() > w.deadline) throw new Timeout(); };

/** Captures-only extension so a search never stops in the middle of an exchange. */
function quiesce(w, side, alpha, beta, qd) {
  tick(w);
  if (w.winner) return w.winner === side ? BIG : -BIG;
  const stand = (side === ME ? 1 : -1) * w.mat;
  if (qd <= 0 || stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  for (const m of gen(w, side, true)) {
    const u = applyS(w, m, side);
    const v = -quiesce(w, 3 - side, -beta, -alpha, qd - 1);
    undoS(w, u);
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function search(w, side, depth, alpha, beta) {
  tick(w);
  if (w.winner) return w.winner === side ? BIG : -BIG;
  if (depth <= 0) return quiesce(w, side, alpha, beta, 4);
  const moves = gen(w, side, false);
  if (!moves.length) return -BIG / 2;
  let best = -Infinity;
  for (const m of moves) {
    const u = applyS(w, m, side);
    const v = -search(w, 3 - side, depth - 1, -beta, -alpha);
    undoS(w, u);
    if (v > best) { best = v; if (v > alpha) { alpha = v; if (alpha >= beta) break; } }
  }
  return best;
}

function searchPick(state, owner, moves, base, opts) {
  const n = state.size;
  const depth = opts.depth ?? (n <= 12 ? 3 : 2);
  const budget = opts.timeMs ?? (n <= 12 ? 450 : 700);
  const maxSamples = opts.samples ?? 24;
  const K = Math.min(moves.length, opts.candidates ?? 10);
  const order = moves.map((_, i) => i).sort((a, b) => base[b] - base[a]).slice(0, K);
  const counts = unknownCounts(state, enemyOf(owner));
  const lakes = Uint8Array.from(state.lakes, (v) => (v ? 1 : 0));
  const sums = new Float64Array(K);
  const t0 = now();
  const deadline = t0 + budget * 1.5;
  let samples = 0;
  do {
    const w = sampleWorld(state, owner, counts, lakes);
    w.deadline = deadline;
    const part = new Float64Array(K);
    try {
      for (let k = 0; k < K; k++) {
        const m = moves[order[k]];
        const u = applyS(w, (m.from << 10) | m.to, ME);
        part[k] = -search(w, OPP, depth - 1, -Infinity, Infinity);
        undoS(w, u);
      }
    } catch (e) {
      if (e instanceof Timeout) break; // discard the unfinished sample
      throw e;
    }
    for (let k = 0; k < K; k++) sums[k] += part[k];
    samples++;
  } while (samples < maxSamples && now() - t0 < budget);

  let bestK = 0, bestV = -Infinity;
  for (let k = 0; k < K; k++) {
    const v = (samples ? sums[k] / samples : 0) + 0.25 * base[order[k]];
    if (v > bestV) { bestV = v; bestK = k; }
  }
  return moves[order[bestK]];
}

/**
 * Picks a move for `owner` using only information that player could legitimately see.
 * difficulty: 'easy' | 'medium' | 'hard'. opts (hard only): { timeMs, depth, samples, candidates }.
 */
export function pickMove(state, owner = 'blue', difficulty = 'medium', opts = {}) {
  const level = LEVELS[difficulty] || LEVELS.medium;
  const moves = legalMoves(state, owner);
  if (!moves.length) return null;
  if (level.blunder && Math.random() < level.blunder) return moves[Math.floor(Math.random() * moves.length)];
  const scores = scoreMoves(state, owner, moves, level);
  if (level.search && moves.length > 1) return searchPick(state, owner, moves, scores, opts);
  let best = 0;
  for (let i = 1; i < moves.length; i++) if (scores[i] > scores[best]) best = i;
  return moves[best];
}
