// Board topologies: the shape of the playing field, independent of the rules.
//
// A topology is a graph of cells with a fixed number of directions D (4 for the square board, 6 for hexagons):
//   { kind, D, cells, coords, adj, nbr, lake, lakes, zones, zoneRows, dist, ... }
//   nbr[c * D + d]  index of the neighbouring cell in direction d, or -1 (edge of the board or a lake).
//   adj[c * D + d]  the same, ignoring lakes (used to build and check lakes).
// A "straight line" (for scouts) is simply the same direction d repeated.
//
// The hexagon board is a hexagram, like a Chinese-checkers board: a central hexagonal arena of radius `a` with six
// triangular camps of side `a` (a(a+1)/2 cells, the size of an army). Only the camps in use are part of the board.
// Hex cells use axial coordinates (q, r), pointy-top, with s = -q - r.

export const PALETTE = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

/** Camp indices (0..5, clockwise from the bottom) used for each player count. Every layout is symmetric. */
export const HEX_TIPS = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };
export const HEX_SIZES = { small: 6, medium: 7, large: 8 };
export const HEX_PLAYERS = [2, 3, 4, 5, 6];

const SQUARE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]]; // (d row, d col)
export const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]; // (d q, d r); opposite of d is (d + 3) % 6

// ---- hex coordinate helpers ------------------------------------------------------------------
/** Rotates an axial coordinate 60 degrees clockwise (as seen on screen). */
export const rotateOnce = (q, r) => [-r, q + r];
export function rotateAxial(q, r, times) {
  let p = [q, r];
  for (let k = ((times % 6) + 6) % 6; k > 0; k--) p = rotateOnce(p[0], p[1]);
  return p;
}
/** Mirror image across the vertical axis (camp t maps to camp -t). */
export const mirrorAxial = (q, r) => [-q - r, r];
export const hexDistance = (q1, r1, q2, r2) => (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
/** Pixel position of a hex centre in units of the hex radius (pointy-top, y grows downward). */
export const hexPixel = (q, r) => [Math.sqrt(3) * (q + r / 2), 1.5 * r];

// ---- square ------------------------------------------------------------------------------------
/** Zones of the classic board: each side's first `depthFor(n)` rows, back row first. */
function squareZones(n, depth) {
  const rows = (rs) => rs.map((r) => Array.from({ length: n }, (_, c) => r * n + c));
  const red = rows(Array.from({ length: depth }, (_, k) => n - 1 - k));
  const blue = rows(Array.from({ length: depth }, (_, k) => k));
  return { zoneRows: { red, blue }, zones: { red: red.flat(), blue: blue.flat() } };
}

export function squareTopology(n, lakes, depth) {
  const cells = n * n;
  const lake = Uint8Array.from({ length: cells }, (_, i) => (lakes && lakes[i] ? 1 : 0));
  const adj = new Int16Array(cells * 4).fill(-1);
  for (let i = 0; i < cells; i++) {
    const r = Math.floor(i / n), c = i % n;
    SQUARE_DIRS.forEach(([dr, dc], d) => {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < n && nc >= 0 && nc < n) adj[i * 4 + d] = nr * n + nc;
    });
  }
  const nbr = Int16Array.from(adj, (j) => (j >= 0 && lake[j] ? -1 : j));
  const coords = Array.from({ length: cells }, (_, i) => [Math.floor(i / n), i % n]);
  return {
    kind: 'square', D: 4, n, cells, coords, adj, nbr, lake, lakes: Array.from(lake, Boolean),
    ...squareZones(n, depth),
    dist: (i, j) => Math.abs(coords[i][0] - coords[j][0]) + Math.abs(coords[i][1] - coords[j][1]),
  };
}

// ---- hexagon (hexagram) -------------------------------------------------------------------------
const key = (q, r) => q * 1000 + r;

/** Axial cells of camp `k`, row by row from the camp's vertex (row 1: one cell) to its base (row a: a cells). */
function campRows(a, k) {
  const rows = [];
  for (let j = 1; j <= a; j++) {
    const r0 = 2 * a - j + 1; // camp 0 is the bottom camp: r > a
    const row = [];
    for (let q = -a; q <= j - a - 1; q++) row.push(rotateAxial(q, r0, k));
    rows.push(row);
  }
  return rows;
}

/**
 * @param {object} o
 * @param {number} o.a        arena radius = camp side (6, 7, 8 -> armies of 21, 28, 36)
 * @param {number} o.players  2..6
 * @param {number[]} [o.lakes] cell indices that are lakes
 */
export function hexTopology({ a = 7, players = 3, lakes = [] } = {}) {
  const tips = HEX_TIPS[players];
  if (!tips) throw new Error(`Hex boards support 2 to 6 players, not ${players}`);
  const ids = PALETTE.slice(0, players);
  const coords = [];
  const index = new Map();
  const add = (q, r) => { index.set(key(q, r), coords.length); coords.push([q, r]); return coords.length - 1; };

  for (let r = -a; r <= a; r++) for (let q = Math.max(-a, -a - r); q <= Math.min(a, a - r); q++) add(q, r);
  const arena = coords.length;
  const rowsByCamp = {};
  for (const k of [...tips].sort((x, y) => x - y)) {
    rowsByCamp[k] = campRows(a, k).map((row) => row.map(([q, r]) => add(q, r)));
  }

  const cells = coords.length;
  const adj = new Int16Array(cells * 6).fill(-1);
  coords.forEach(([q, r], i) => {
    HEX_DIRS.forEach(([dq, dr], d) => {
      const j = index.get(key(q + dq, r + dr));
      if (j !== undefined) adj[i * 6 + d] = j;
    });
  });

  const zoneRows = {}, zones = {};
  ids.forEach((id, seat) => { zoneRows[id] = rowsByCamp[tips[seat]]; zones[id] = zoneRows[id].flat(); });
  const ring = coords.map(([q, r]) => Math.max(Math.abs(q), Math.abs(r), Math.abs(q + r)));

  const topo = {
    kind: 'hex', D: 6, a, players, ids, tips, cells, arena, coords, index, adj, ring, zones, zoneRows,
    dist: (i, j) => hexDistance(coords[i][0], coords[i][1], coords[j][0], coords[j][1]),
  };
  return applyLakes(topo, lakes);
}

/** A copy of the topology with the given lake cells (indices) blocked. */
export function applyLakes(topo, lakeCells) {
  const lake = new Uint8Array(topo.cells);
  for (const i of lakeCells) lake[i] = 1;
  const nbr = Int16Array.from(topo.adj, (j) => (j >= 0 && lake[j] ? -1 : j));
  return { ...topo, lake, nbr, lakes: Array.from(lake, Boolean) };
}

// ---- symmetry and lakes ---------------------------------------------------------------------------
/** Rotations and reflections of the board that map the set of occupied camps onto itself. */
export function hexSymmetries(tips) {
  const set = new Set(tips);
  const ok = (f) => tips.every((t) => set.has(((f(t) % 6) + 6) % 6));
  const out = [];
  for (let k = 0; k < 6; k++) if (ok((t) => t + k)) out.push((q, r) => rotateAxial(q, r, k));
  for (let k = 0; k < 6; k++) if (ok((t) => k - t)) out.push((q, r) => rotateAxial(...mirrorAxial(q, r), k));
  return out;
}

/** True when every passable cell can be reached from every other one. */
export function isConnected(topo) {
  const start = topo.lake.findIndex((l) => !l);
  if (start < 0) return true;
  const seen = new Uint8Array(topo.cells);
  const stack = [start];
  seen[start] = 1;
  let count = 1;
  while (stack.length) {
    const i = stack.pop();
    for (let d = 0; d < topo.D; d++) {
      const j = topo.nbr[i * topo.D + d];
      if (j >= 0 && !seen[j]) { seen[j] = 1; count++; stack.push(j); }
    }
  }
  let passable = 0;
  for (let i = 0; i < topo.cells; i++) if (!topo.lake[i]) passable++;
  return count === passable;
}

/**
 * Random lakes for a hex board: small blobs in the arena (never next to the camps), repeated under every symmetry of
 * the occupied camps so no player is favoured, and never splitting the board. Returns cell indices.
 */
export function hexLakes(topo, rng = Math.random) {
  const { a, coords, ring, index, adj } = topo;
  const group = hexSymmetries(topo.tips);
  const cand = [];
  for (let i = 0; i < topo.arena; i++) if (ring[i] <= a - 2) cand.push(i);
  const inCand = new Set(cand);
  const image = (i, g) => { const [q, r] = g(coords[i][0], coords[i][1]); return index.get(key(q, r)); };
  const target = Math.round(cand.length * 0.14);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  for (let attempt = 0; attempt < 80; attempt++) {
    const lake = new Set();
    for (let tries = 0; tries < 300 && lake.size < target; tries++) {
      const blob = [pick(cand)];
      for (let grow = Math.floor(rng() * 3); grow > 0; grow--) {
        const options = [];
        for (const c of blob) for (let d = 0; d < 6; d++) {
          const j = adj[c * 6 + d];
          if (j >= 0 && inCand.has(j) && !blob.includes(j)) options.push(j);
        }
        if (!options.length) break;
        blob.push(pick(options));
      }
      const orbit = new Set();
      for (const g of group) for (const c of blob) orbit.add(image(c, g));
      let clash = false;
      for (const c of orbit) {
        if (lake.has(c)) { clash = true; break; }
        for (let d = 0; d < 6 && !clash; d++) { const j = adj[c * 6 + d]; if (j >= 0 && lake.has(j)) clash = true; }
        if (clash) break;
      }
      if (clash) continue;
      for (const c of orbit) lake.add(c);
    }
    if (!lake.size) continue;
    if (isConnected(applyLakes(topo, [...lake]))) return [...lake];
  }
  return [];
}

/** A hex topology with freshly rolled symmetric lakes. */
export function randomHexTopology(a, players, rng = Math.random) {
  const base = hexTopology({ a, players });
  return applyLakes(base, hexLakes(base, rng));
}

// ---- helpers for rules, AI and drawing ------------------------------------------------------------
/** Multi-source breadth-first distance (in steps) to the nearest source cell; -1 where unreachable. */
export function distanceField(topo, sources) {
  const dist = new Int16Array(topo.cells).fill(-1);
  const queue = [];
  for (const s of sources) if (dist[s] < 0) { dist[s] = 0; queue.push(s); }
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h];
    for (let d = 0; d < topo.D; d++) {
      const j = topo.nbr[i * topo.D + d];
      if (j >= 0 && dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
    }
  }
  return dist;
}

/**
 * On-screen layout of a topology as percentages of the board box, viewed by the player sitting in camp `viewCamp`
 * (the board is rotated so that camp is at the bottom). Square boards ignore the rotation argument beyond a half turn.
 * Returns { width, height (aspect, in cell widths), place(cell) -> {left, top, w, h} in % }.
 */
export function boardLayout(topo, viewCamp = 0) {
  if (topo.kind === 'square') {
    const n = topo.n, u = 100 / n;
    const flip = viewCamp === 1; // the second seat sees the board turned half a turn
    const place = (i) => { const c = flip ? topo.cells - 1 - i : i; return { left: (c % n) * u, top: Math.floor(c / n) * u, w: u, h: u }; };
    return { aspect: 1, place };
  }
  const turn = (6 - viewCamp) % 6; // rotating by (6 - k) steps puts camp k at the bottom
  const pts = topo.coords.map(([q, r]) => hexPixel(...rotateAxial(q, r, turn)));
  const w = Math.sqrt(3), h = 2; // a hex cell is sqrt(3) wide and 2 tall (radius 1)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) { minX = Math.min(minX, x - w / 2); maxX = Math.max(maxX, x + w / 2); minY = Math.min(minY, y - h / 2); maxY = Math.max(maxY, y + h / 2); }
  const W = maxX - minX, H = maxY - minY;
  const place = (i) => ({ left: ((pts[i][0] - w / 2 - minX) / W) * 100, top: ((pts[i][1] - h / 2 - minY) / H) * 100, w: (w / W) * 100, h: (h / H) * 100 });
  return { aspect: W / H, place };
}
