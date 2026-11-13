import test from 'node:test';
import assert from 'node:assert/strict';
import { SIZES, makeConfig, armyFor, armyTotal, depthFor, randomLakes, randomSetup, createState, legalMoves, applyMove, rowOf, colOf, idx, FLAG } from '../src/game.js';
import { pickMove } from '../src/ai.js';

test('army fills the starting zone with exactly one flag', () => {
  for (const n of SIZES) {
    const a = armyFor(n);
    assert.equal(armyTotal(a), n * depthFor(n) , `size ${n}`);
    assert.equal(a[FLAG], 1);
    assert.ok(Object.values(a).every((v) => v >= 1));
  }
  assert.equal(armyTotal(armyFor(10)), 40);
});

test('random lakes stay in the middle band, are symmetric and keep the board connected', () => {
  for (const n of [12, 16, 20]) {
    for (let t = 0; t < 40; t++) {
      const lakes = randomLakes(n), d = depthFor(n);
      assert.ok(lakes.some(Boolean), 'has lakes');
      lakes.forEach((l, i) => {
        if (!l) return;
        assert.ok(rowOf(i, n) >= d && rowOf(i, n) < n - d, 'only in band');
        assert.ok(lakes[n * n - 1 - i], '180 degree symmetric');
      });
      const free = lakes.map((l, i) => (l ? -1 : i)).filter((i) => i >= 0);
      const seen = new Set([free[0]]), st = [free[0]];
      while (st.length) {
        const i = st.pop();
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const r = rowOf(i, n) + dr, c = colOf(i, n) + dc, j = idx(r, c, n);
          if (r >= 0 && r < n && c >= 0 && c < n && !lakes[j] && !seen.has(j)) { seen.add(j); st.push(j); }
        }
      }
      assert.equal(seen.size, free.length, 'connected');
    }
  }
});

test('setup fills own zone with the right army on every size', () => {
  for (const n of SIZES) for (const owner of ['red', 'blue']) {
    const s = randomSetup(owner, n), counts = {};
    for (const [i, r] of Object.entries(s)) {
      counts[r] = (counts[r] || 0) + 1;
      const row = rowOf(Number(i), n);
      assert.ok(owner === 'red' ? row >= n - depthFor(n) : row < depthFor(n));
    }
    assert.deepEqual(counts, armyFor(n));
  }
});

test('AI vs random plays to completion on larger boards', () => {
  for (const n of [12, 16, 20]) {
    const cfg = makeConfig(n);
    let s = createState(randomSetup('red', n), randomSetup('blue', n), cfg);
    for (let i = 0; i < 4000 && !s.winner; i++) {
      const moves = legalMoves(s, s.turn);
      const m = s.turn === 'blue' ? pickMove(s, 'blue') : moves[Math.floor(Math.random() * moves.length)];
      assert.ok(m);
      assert.ok(!cfg.lakes[m.to], 'never enters a lake');
      s = applyMove(s, m).state;
    }
  }
});
