// The computer player. It works on any topology and with any number of players and teams, and only uses
// information its player could legitimately have: its own and its teammates' pieces, pieces revealed in combat,
// and the odds of what every other hidden piece is (from the army list and what has been captured so far).
import { legalMoves, resolve, canMove, FLAG, BOMB, SCOUT } from './game.js';
import { distanceField } from './topology.js';

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

/** Rank distribution of the pieces of `owner` that have not been seen yet. */
function unknownCounts(state, owner) {
  const counts = { ...state.army };
  for (const r of state.dead[owner]) counts[r]--;
  for (const p of state.board) if (p && p.owner === owner && p.revealed) counts[p.rank]--;
  return counts;
}

const enemiesOf = (state, owner) => state.players.filter((p) => state.alive[p] && state.teams[p] !== state.teams[owner]);

function threatened(state, owner, at, rank) {
  const { D, nbr } = state.topo;
  for (let d = 0; d < D; d++) {
    const j = nbr[at * D + d];
    if (j < 0) continue;
    const q = state.board[j];
    if (q && state.teams[q.owner] !== state.teams[owner] && q.revealed && canMove(q.rank) && resolve(q.rank, rank) === 'win') return true;
  }
  return false;
}

/** One-move heuristic score for every move. */
function scoreMoves(state, owner, moves, level) {
  const topo = state.topo;
  const enemies = enemiesOf(state, owner);
  // "forward" = closer to the back of the nearest enemy camp
  const field = distanceField(topo, enemies.flatMap((p) => topo.zoneRows[p].slice(0, 2).flat()));
  const countsBy = {};
  return moves.map((m) => {
    const me = state.board[m.from];
    const tgt = state.board[m.to];
    let score = Math.random() * level.jitter;
    if (tgt) {
      if (tgt.revealed) {
        score += outcomeValue(me.rank, tgt.rank);
      } else {
        const c = { ...(countsBy[tgt.owner] ??= unknownCounts(state, tgt.owner)) };
        if (tgt.moved) { c[FLAG] = 0; c[BOMB] = 0; }
        let total = 0, ev = 0;
        for (const [d, k] of Object.entries(c)) { if (k > 0) { total += k; ev += k * outcomeValue(me.rank, Number(d)); } }
        score += total ? ev / total : 0;
        if (me.rank === SCOUT) score += 15; // scouting is worth the information
      }
    } else {
      const gain = field[m.from] >= 0 && field[m.to] >= 0 ? field[m.from] - field[m.to] : 0;
      score += gain * (me.rank === SCOUT ? 0.5 : 2.5);
      if (level.threats) {
        if (threatened(state, owner, m.from, me.rank)) score += VALUE[me.rank] * 0.5;
        if (threatened(state, owner, m.to, me.rank)) score -= VALUE[me.rank] * 0.8;
      }
    }
    return score;
  });
}

// ---------------------------------------------------------------------------------------------
// Hard mode: determinized "paranoid" search. We repeatedly guess a plausible identity for every hidden enemy
// piece, search a few plies on that fully-known board (my team tries to maximize material, everybody else tries to
// minimize it, in the real turn order) and average each candidate's result over many guesses.
// ---------------------------------------------------------------------------------------------
const BIG = 100000;
const ME = 1, OPP = 2;
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

class Timeout extends Error {}

/**
 * A compact, fully-known board: hidden opponent pieces get random ranks drawn from what is still unaccounted for.
 * Players are numbered 1..N in seat order. Material is weighted so my side and the opposing side each count as "one army".
 */
function buildWorld(state, owner, countsBy) {
  const { topo, players } = state;
  const N = players.length;
  const myTeam = state.teams[owner];
  const labels = [...new Set(players.map((p) => state.teams[p]))];
  const team = new Int8Array(N + 1), side = new Int8Array(N + 1), alive = new Uint8Array(N + 1);
  players.forEach((p, i) => {
    team[i + 1] = labels.indexOf(state.teams[p]);
    side[i + 1] = state.teams[p] === myTeam ? ME : OPP;
    alive[i + 1] = state.alive[p] ? 1 : 0;
  });
  let nMe = 0, nOpp = 0;
  for (let i = 1; i <= N; i++) if (alive[i]) { if (side[i] === ME) nMe++; else nOpp++; }
  const wMe = 1 / Math.max(1, nMe), wOpp = 1 / Math.max(1, nOpp);
  const contrib = (pi, rank) => (side[pi] === ME ? wMe : -wOpp) * VALUE[rank];

  const own = new Int8Array(topo.cells), rk = new Int8Array(topo.cells);
  const hidden = {}; // player index -> {moved: [], rest: []}
  let mat = 0;
  state.board.forEach((p, i) => {
    if (!p) return;
    const pi = players.indexOf(p.owner) + 1;
    own[i] = pi;
    if (side[pi] === ME || p.revealed) { rk[i] = p.rank; mat += contrib(pi, p.rank); return; }
    (hidden[pi] ??= { moved: [], rest: [] })[p.moved ? 'moved' : 'rest'].push(i);
  });
  for (const [pi, { moved, rest }] of Object.entries(hidden)) {
    const pool = [];
    for (const [rank, k] of Object.entries(countsBy[players[pi - 1]])) for (let j = 0; j < k; j++) pool.push(Number(rank));
    shuffle(pool);
    const movable = pool.filter((r) => r !== FLAG && r !== BOMB), fixed = pool.filter((r) => r === FLAG || r === BOMB);
    for (const i of moved) { rk[i] = movable.length ? movable.pop() : (fixed.pop() ?? SCOUT); mat += contrib(+pi, rk[i]); } // pieces that moved are not flags or bombs
    const left = shuffle(movable.concat(fixed));
    for (const i of rest) { rk[i] = left.pop() ?? SCOUT; mat += contrib(+pi, rk[i]); }
  }
  return { topo, D: topo.D, nbr: topo.nbr, cells: topo.cells, N, own, rk, team, side, alive, contrib, mat, over: 0, nodes: 0, deadline: Infinity };
}

/** Next living player after `cur` (1-based, cyclic). */
function nextMover(w, cur) {
  for (let k = 1; k <= w.N; k++) { const p = ((cur - 1 + k) % w.N) + 1; if (w.alive[p]) return p; }
  return cur;
}

/** Moves for player `pi`, captures first (most valuable victims first). Scouts only try their first step and full slide. */
function gen(w, pi, capsOnly) {
  const { D, nbr, own, rk, cells, side } = w;
  const mySide = side[pi];
  const caps = [], quiet = [];
  for (let i = 0; i < cells; i++) {
    if (own[i] !== pi) continue;
    const r = rk[i];
    if (r < 1 || r > 10) continue;
    for (let d = 0; d < D; d++) {
      let j = nbr[i * D + d], firstFree = -1, lastFree = -1;
      while (j >= 0) {
        const o = own[j];
        if (o === 0) {
          if (firstFree < 0) firstFree = j;
          lastFree = j;
        } else {
          if (side[o] !== mySide) caps.push((i << 10) | j); // players on the same side never fight in the search
          break;
        }
        if (r !== SCOUT) break;
        j = nbr[j * D + d];
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

/** Plays a move in the world; returns what is needed to take it back. */
function applyS(w, m, pi) {
  const from = m >> 10, to = m & 1023, { own, rk } = w;
  const u = { from, to, of: own[from], rf: rk[from], ot: own[to], rt: rk[to], mat: w.mat, over: w.over, elim: null };
  const a = rk[from];
  if (own[to] === 0) { own[to] = pi; rk[to] = a; own[from] = 0; return u; }
  const def = own[to], d = rk[to], r = resolve(a, d);
  if (r === 'win') {
    w.mat -= w.contrib(def, d);
    own[to] = pi; rk[to] = a; own[from] = 0;
    if (d === FLAG) eliminate(w, def, u);
  } else if (r === 'lose') {
    w.mat -= w.contrib(pi, a); own[from] = 0;
  } else {
    w.mat -= w.contrib(pi, a) + w.contrib(def, d); own[from] = 0; own[to] = 0;
  }
  return u;
}

/** A flag fell: the player is out and their army leaves the board. Sets `over` when only one team is left. */
function eliminate(w, pi, u) {
  const removed = [];
  for (let i = 0; i < w.cells; i++) if (w.own[i] === pi) { removed.push([i, w.rk[i]]); w.mat -= w.contrib(pi, w.rk[i]); w.own[i] = 0; }
  w.alive[pi] = 0;
  u.elim = { pi, removed };
  const teams = new Set();
  let meLeft = false;
  for (let p = 1; p <= w.N; p++) if (w.alive[p]) { teams.add(w.team[p]); if (w.side[p] === ME) meLeft = true; }
  if (teams.size <= 1) w.over = meLeft ? BIG : -BIG;
}

function undoS(w, u) {
  if (u.elim) {
    for (const [i, rank] of u.elim.removed) { w.own[i] = u.elim.pi; w.rk[i] = rank; }
    w.alive[u.elim.pi] = 1;
  }
  w.own[u.from] = u.of; w.rk[u.from] = u.rf; w.own[u.to] = u.ot; w.rk[u.to] = u.rt; w.mat = u.mat; w.over = u.over;
}

const tick = (w) => { if ((++w.nodes & 1023) === 0 && now() > w.deadline) throw new Timeout(); };

/** Captures-only extension so a search never stops in the middle of an exchange. */
function quiesce(w, pi, alpha, beta, qd) {
  tick(w);
  if (w.over) return w.over;
  const max = w.side[pi] === ME;
  const stand = w.mat;
  if (qd <= 0) return stand;
  if (max) { if (stand >= beta) return stand; if (stand > alpha) alpha = stand; }
  else { if (stand <= alpha) return stand; if (stand < beta) beta = stand; }
  for (const m of gen(w, pi, true)) {
    const u = applyS(w, m, pi);
    const v = quiesce(w, nextMover(w, pi), alpha, beta, qd - 1);
    undoS(w, u);
    if (max) { if (v >= beta) return v; if (v > alpha) alpha = v; } else { if (v <= alpha) return v; if (v < beta) beta = v; }
  }
  return max ? alpha : beta;
}

/** Value (from my team's point of view) of the position with player `pi` to move. */
function search(w, pi, depth, alpha, beta) {
  tick(w);
  if (w.over) return w.over;
  if (depth <= 0) return quiesce(w, pi, alpha, beta, 4);
  const moves = gen(w, pi, false);
  if (!moves.length) return search(w, nextMover(w, pi), depth - 1, alpha, beta); // stuck players just pass in the search
  const max = w.side[pi] === ME;
  let best = max ? -Infinity : Infinity;
  for (const m of moves) {
    const u = applyS(w, m, pi);
    const v = search(w, nextMover(w, pi), depth - 1, alpha, beta);
    undoS(w, u);
    if (max) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}

function searchPick(state, owner, moves, base, opts) {
  const topo = state.topo;
  const players = state.players.length;
  const squareSize = state.size;
  const depth = opts.depth ?? (topo.kind === 'square' ? (squareSize <= 12 ? 3 : 2) : players <= 3 ? 3 : 2);
  const budget = opts.timeMs ?? (topo.kind === 'square' ? (squareSize <= 12 ? 450 : 700) : players <= 3 ? 350 : 220);
  const maxSamples = opts.samples ?? 24;
  const K = Math.min(moves.length, opts.candidates ?? 10);
  const order = moves.map((_, i) => i).sort((a, b) => base[b] - base[a]).slice(0, K);
  const countsBy = {};
  for (const p of state.players) if (state.alive[p] && state.teams[p] !== state.teams[owner]) countsBy[p] = unknownCounts(state, p);
  const me = state.players.indexOf(owner) + 1;
  const sums = new Float64Array(K);
  const t0 = now();
  const deadline = t0 + budget * 1.5;
  let samples = 0;
  do {
    const w = buildWorld(state, owner, countsBy);
    w.deadline = deadline;
    const part = new Float64Array(K);
    try {
      for (let k = 0; k < K; k++) {
        const m = moves[order[k]];
        const u = applyS(w, (m.from << 10) | m.to, me);
        part[k] = search(w, nextMover(w, me), depth - 1, -Infinity, Infinity);
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
