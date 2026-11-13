import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyMove, legalMoves, reachable, randomSetup, idx, INITIAL, isLake, FLAG, BOMB, SPY, SCOUT, MINER, MARSHAL } from '../src/game.js';
import { pickMove } from '../src/ai.js';

const empty = () => createState({}, {});
const put = (s, r, c, owner, rank, extra = {}) => { s.board[idx(r, c)] = { id: Math.random(), owner, rank, revealed: false, moved: false, ...extra }; };

test('random setup has full army in own territory', () => {
  for (const owner of ['red', 'blue']) {
    const s = randomSetup(owner);
    const counts = {};
    for (const [i, r] of Object.entries(s)) {
      counts[r] = (counts[r] || 0) + 1;
      const row = Math.floor(i / 10);
      assert.ok(owner === 'red' ? row >= 6 : row <= 3);
    }
    assert.deepEqual(counts, Object.fromEntries(Object.entries(INITIAL)));
  }
});

test('lakes block movement', () => {
  const s = empty(); put(s, 4, 1, 'red', 5);
  assert.ok(!reachable(s, idx(4, 1)).includes(idx(4, 2)));
  assert.ok(isLake(5, 6));
});

test('scout slides, stops at enemies and cannot jump', () => {
  const s = empty(); put(s, 6, 0, 'red', SCOUT); put(s, 3, 0, 'blue', 5);
  const r = reachable(s, idx(6, 0));
  assert.ok(r.includes(idx(4, 0)) && r.includes(idx(3, 0)) && !r.includes(idx(2, 0)));
});

test('combat rules', () => {
  const fight = (a, d) => {
    const s = empty(); put(s, 6, 0, 'red', a); put(s, 5, 0, 'blue', d); put(s, 0, 9, 'blue', 2);
    return applyMove(s, { from: idx(6, 0), to: idx(5, 0) });
  };
  assert.equal(fight(MARSHAL, 5).event.result, 'win');
  assert.equal(fight(4, 8).event.result, 'lose');
  assert.equal(fight(6, 6).event.result, 'tie');
  assert.equal(fight(SPY, MARSHAL).event.result, 'win');
  assert.equal(fight(MARSHAL, SPY).event.result, 'win');
  assert.equal(fight(MINER, BOMB).event.result, 'win');
  assert.equal(fight(MARSHAL, BOMB).event.result, 'lose');
  const f = fight(5, FLAG);
  assert.equal(f.state.winner, 'red');
});

test('bomb survives and is revealed', () => {
  const s = empty(); put(s, 6, 0, 'red', 9); put(s, 5, 0, 'blue', BOMB); put(s, 0, 9, 'blue', 2);
  const { state } = applyMove(s, { from: idx(6, 0), to: idx(5, 0) });
  assert.equal(state.board[idx(5, 0)].rank, BOMB);
  assert.ok(state.board[idx(5, 0)].revealed);
  assert.equal(state.board[idx(6, 0)], null);
});

test('no legal moves loses', () => {
  const s = empty(); put(s, 6, 0, 'red', 5); put(s, 0, 0, 'blue', BOMB); put(s, 0, 1, 'blue', FLAG);
  assert.equal(applyMove(s, { from: idx(6, 0), to: idx(5, 0) }).state.winner, 'red');
});

test('two-square rule stops a 4th consecutive shuttle', () => {
  let s = empty(); put(s, 6, 0, 'red', 5); put(s, 0, 0, 'blue', 5); put(s, 0, 1, 'blue', 5);
  const a = idx(6, 0), b = idx(5, 0), x = idx(0, 0), y = idx(1, 0);
  const seq = [[a, b], [x, y], [b, a], [y, x], [a, b], [x, y]];
  for (const [from, to] of seq) s = applyMove(s, { from, to }).state;
  // red has moved a->b, b->a, a->b: next b->a is illegal
  assert.ok(!legalMoves(s, 'red').some((m) => m.from === b && m.to === a));
  assert.ok(legalMoves(s, 'red').some((m) => m.from === b && m.to !== a));
});

test('AI plays a full game against random without errors', () => {
  let s = createState(randomSetup('red'), randomSetup('blue'));
  for (let i = 0; i < 3000 && !s.winner; i++) {
    const moves = legalMoves(s, s.turn);
    const m = s.turn === 'blue' ? pickMove(s, 'blue') : moves[Math.floor(Math.random() * moves.length)];
    assert.ok(m);
    s = applyMove(s, m).state;
  }
});
