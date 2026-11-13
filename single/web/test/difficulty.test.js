import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, legalMoves, randomSetup, makeConfig, idx, SPY, FLAG } from '../src/game.js';
import { pickMove, DIFFICULTIES } from '../src/ai.js';

const reveal = (s, r, c) => { s.board[idx(r, c)].revealed = true; return s; };
const isMove = (m, fr, fc, tr, tc) => m.from === idx(fr, fc) && m.to === idx(tr, tc);

test('every difficulty returns a legal move on every board size', () => {
  for (const n of [10, 12, 20]) {
    const cfg = makeConfig(n);
    const s = createState(randomSetup('red', n), randomSetup('blue', n), cfg);
    const legal = legalMoves(s, 'blue');
    for (const d of DIFFICULTIES) {
      for (let k = 0; k < 5; k++) {
        const m = pickMove(s, 'blue', d, { timeMs: 40 });
        assert.ok(legal.some((l) => l.from === m.from && l.to === m.to), `${d} on ${n}x${n}`);
      }
    }
  }
});

test('unknown difficulty falls back to medium and no-move positions return null', () => {
  const s = createState(randomSetup('red'), randomSetup('blue'));
  assert.ok(pickMove(s, 'blue', 'nonsense'));
  const dead = createState({ [idx(9, 9)]: FLAG }, { [idx(0, 0)]: FLAG });
  assert.equal(pickMove(dead, 'blue', 'hard'), null);
});

test('all levels grab an exposed flag', () => {
  const s = createState({ [idx(5, 0)]: FLAG, [idx(9, 9)]: 5 }, { [idx(4, 0)]: SPY, [idx(0, 5)]: FLAG });
  reveal(s, 5, 0);
  for (const d of ['medium', 'hard']) assert.ok(isMove(pickMove(s, 'blue', d, { timeMs: 40 }), 4, 0, 5, 0), d);
});

// Blue Captain can take a revealed Sergeant, but a revealed Major would then take the Captain.
function poisoned() {
  const s = createState(
    { [idx(5, 0)]: 4, [idx(6, 0)]: 7, [idx(9, 9)]: FLAG },
    { [idx(4, 0)]: 6, [idx(0, 5)]: FLAG, [idx(0, 6)]: 2 },
  );
  reveal(s, 5, 0); reveal(s, 6, 0);
  return s;
}

test('medium takes the poisoned capture; hard sees the recapture and declines', () => {
  const s = poisoned();
  for (let k = 0; k < 5; k++) assert.ok(isMove(pickMove(s, 'blue', 'medium'), 4, 0, 5, 0), 'medium');
  for (let k = 0; k < 5; k++) assert.ok(!isMove(pickMove(s, 'blue', 'hard', { timeMs: 60 }), 4, 0, 5, 0), 'hard');
});

test('hard respects its time budget on the largest board', () => {
  const cfg = makeConfig(20);
  const s = createState(randomSetup('red', 20), randomSetup('blue', 20), cfg);
  const t = performance.now();
  pickMove(s, 'blue', 'hard', { timeMs: 100 });
  assert.ok(performance.now() - t < 1500, `took ${performance.now() - t}ms`);
});
