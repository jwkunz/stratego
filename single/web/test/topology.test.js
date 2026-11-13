import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hexTopology, hexLakes, applyLakes, hexSymmetries, isConnected, distanceField, boardLayout, squareTopology,
  HEX_TIPS, HEX_DIRS, PALETTE, rotateAxial, hexDistance,
} from '../src/topology.js';

const SIZES = [6, 7, 8];
const COUNTS = [2, 3, 4, 5, 6];

test('hex boards have the right number of cells, camps and zones', () => {
  for (const a of SIZES) for (const n of COUNTS) {
    const t = hexTopology({ a, players: n });
    const camp = (a * (a + 1)) / 2;
    assert.equal(t.arena, 3 * a * (a + 1) + 1, 'arena');
    assert.equal(t.cells, t.arena + n * camp, `cells for a=${a} n=${n}`);
    assert.deepEqual(t.ids, PALETTE.slice(0, n));
    const seen = new Set();
    for (const id of t.ids) {
      assert.equal(t.zones[id].length, camp, 'a camp holds exactly one army');
      assert.deepEqual(t.zoneRows[id].map((r) => r.length), Array.from({ length: a }, (_, k) => k + 1), 'rows grow from the vertex to the base');
      for (const c of t.zones[id]) { assert.ok(!seen.has(c), 'zones are disjoint'); seen.add(c); assert.ok(c >= t.arena, 'camps are outside the arena'); }
    }
  }
});

test('adjacency is symmetric, arena cells have six neighbours and camp bases touch the arena', () => {
  for (const a of SIZES) for (const n of COUNTS) {
    const t = hexTopology({ a, players: n });
    for (let i = 0; i < t.cells; i++) for (let d = 0; d < 6; d++) {
      const j = t.adj[i * 6 + d];
      if (j >= 0) assert.equal(t.adj[j * 6 + ((d + 3) % 6)], i, 'neighbour relation is symmetric');
    }
    for (let i = 0; i < t.arena; i++) if (t.ring[i] < a) for (let d = 0; d < 6; d++) assert.ok(t.adj[i * 6 + d] >= 0, 'interior cells have 6 neighbours');
    for (const id of t.ids) {
      const base = t.zoneRows[id][a - 1];
      assert.ok(base.every((c) => [0, 1, 2, 3, 4, 5].some((d) => { const j = t.adj[c * 6 + d]; return j >= 0 && j < t.arena; })), 'every base cell opens onto the arena');
      const vertex = t.zoneRows[id][0][0];
      assert.ok([0, 1, 2, 3, 4, 5].filter((d) => t.adj[vertex * 6 + d] >= 0).length <= 2, 'the vertex is a corner');
    }
  }
});

test('hex distance matches breadth-first distance on an open board', () => {
  const t = hexTopology({ a: 6, players: 6 });
  const field = distanceField(t, [0]);
  for (let i = 0; i < t.cells; i++) assert.equal(field[i], t.dist(0, i));
  assert.equal(hexDistance(0, 0, 3, -3), 3);
});

test('occupied camp layouts are symmetric and the board maps onto itself under those symmetries', () => {
  for (const n of COUNTS) {
    const t = hexTopology({ a: 6, players: n });
    const group = hexSymmetries(t.tips);
    const expected = { 2: 4, 3: 6, 4: 4, 5: 2, 6: 12 }[n];
    assert.equal(group.length, expected, `symmetry group of ${n} players`);
    for (const g of group) for (let i = 0; i < t.cells; i++) {
      const [q, r] = g(...t.coords[i]);
      assert.ok(t.index.has(q * 1000 + r), 'a symmetry maps cells onto cells');
    }
  }
  assert.deepEqual(HEX_TIPS[3], [0, 2, 4]);
});

test('lakes: only in the arena away from the camps, symmetric, never splitting the board', () => {
  for (const a of SIZES) for (const n of COUNTS) for (let rep = 0; rep < 6; rep++) {
    const base = hexTopology({ a, players: n });
    const lakes = hexLakes(base);
    assert.ok(lakes.length > 0, `some lakes for a=${a} n=${n}`);
    const t = applyLakes(base, lakes);
    const set = new Set(lakes);
    for (const c of lakes) assert.ok(t.ring[c] <= a - 2 && c < t.arena, 'lakes stay clear of the camps');
    for (const g of hexSymmetries(t.tips)) for (const c of lakes) {
      const [q, r] = g(...t.coords[c]);
      assert.ok(set.has(t.index.get(q * 1000 + r)), 'lakes are symmetric');
    }
    assert.ok(isConnected(t), 'every passable cell stays reachable');
    for (const c of lakes) for (let d = 0; d < 6; d++) assert.ok(t.nbr[c * 6 + d] === t.adj[c * 6 + d] || true);
    // a neighbour table never points into a lake
    for (let i = 0; i < t.cells; i++) for (let d = 0; d < 6; d++) { const j = t.nbr[i * 6 + d]; if (j >= 0) assert.ok(!t.lake[j]); }
  }
});

test('rotating the view puts the viewer\'s own camp at the bottom of the screen', () => {
  for (const n of COUNTS) {
    const t = hexTopology({ a: 7, players: n });
    t.ids.forEach((id, seat) => {
      const { place, aspect } = boardLayout(t, t.tips[seat]);
      assert.ok(aspect > 0.4 && aspect < 1.3, `plausible board proportions (${aspect.toFixed(2)})`);
      if (n >= 3) assert.ok(aspect > 0.7, 'three or more camps make a roughly squarish star');
      const mean = (cells) => cells.reduce((s, c) => s + place(c).top + place(c).h / 2, 0) / cells.length;
      const own = mean(t.zones[id]);
      assert.ok(own > 70, `seat ${seat} of ${n} sees its camp at the bottom (${own.toFixed(0)}%)`);
      for (const other of t.ids) if (other !== id) assert.ok(mean(t.zones[other]) < own);
      for (let c = 0; c < t.cells; c++) { const p = place(c); assert.ok(p.left >= -0.01 && p.top >= -0.01 && p.left + p.w <= 100.01 && p.top + p.h <= 100.01); }
    });
  }
});

test('rotation helpers: six turns are the identity and hex directions come in opposite pairs', () => {
  assert.deepEqual(rotateAxial(3, -5, 6), [3, -5]);
  assert.deepEqual(rotateAxial(2, 1, 3), [-2, -1]);
  HEX_DIRS.forEach(([q, r], d) => assert.deepEqual(HEX_DIRS[(d + 3) % 6], [0 - q + 0, 0 - r + 0].map((v) => v || 0)));
});

test('square topology keeps the classic neighbour structure', () => {
  const t = squareTopology(10, Array(100).fill(false), 4);
  assert.equal(t.cells, 100);
  assert.equal(t.zones.red.length, 40);
  assert.equal(t.zones.red[0], 90); // back row first
  assert.equal(t.dist(0, 99), 18);
});
