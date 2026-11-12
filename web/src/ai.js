import { legalMoves, resolve, rowOf, colOf, idx, enemyOf, canMove, FLAG, BOMB, SCOUT } from './game.js';

const VALUE = [1000, 30, 10, 25, 20, 30, 45, 60, 80, 100, 150, 40];

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

/** Picks a move for `owner` using only information that player could legitimately see. */
export function pickMove(state, owner = 'blue') {
  const enemy = enemyOf(owner);
  const moves = legalMoves(state, owner);
  const counts = unknownCounts(state, enemy);
  const forward = owner === 'blue' ? 1 : -1;
  let best = null, bestScore = -Infinity;

  for (const m of moves) {
    const me = state.board[m.from];
    const tgt = state.board[m.to];
    let score = Math.random() * 3;

    if (tgt) {
      if (tgt.revealed) {
        score += outcomeValue(me.rank, tgt.rank);
      } else {
        const c = { ...counts };
        if (tgt.moved) { c[FLAG] = 0; c[BOMB] = 0; }
        let total = 0, ev = 0;
        for (const [d, n] of Object.entries(c)) { if (n > 0) { total += n; ev += n * outcomeValue(me.rank, Number(d)); } }
        score += total ? ev / total : 0;
        if (me.rank === SCOUT) score += 15; // scouting is worth the information
      }
    } else {
      const rows = (rowOf(m.to, state.size) - rowOf(m.from, state.size)) * forward;
      score += rows * (me.rank === SCOUT ? 0.5 : 2.5);
      if (threatened(state, owner, m.from, me.rank)) score += VALUE[me.rank] * 0.5;
      if (threatened(state, owner, m.to, me.rank)) score -= VALUE[me.rank] * 0.8;
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}
