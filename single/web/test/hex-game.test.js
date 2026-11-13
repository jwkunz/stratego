import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeHexConfig, createStateN, legalMoves, reachable, applyMove, randomSetupFor, hexArmy, armyTotal, hasLegalMove,
  rerollHexLakes, FLAG, BOMB, SCOUT, MINER, MARSHAL, SPY,
} from '../src/game.js';
import { HEX_DIRS } from '../src/topology.js';

const open = (players, teams = null, a = 6) => makeHexConfig({ a, players, teams, lakes: [] });
const cell = (cfg, q, r) => cfg.topo.index.get(q * 1000 + r);
/** A state with exactly the listed pieces: [[player, rank, q, r], ...] */
function scene(cfg, pieces) {
  const s = createStateN({}, cfg);
  const board = s.board.slice();
  pieces.forEach(([player, rank, q, r], k) => { board[cell(cfg, q, r)] = { id: 9000 + k, owner: player, rank, revealed: false, moved: false }; });
  return { ...s, board };
}

test('hex armies fill a camp exactly and keep one flag', () => {
  for (const a of [6, 7, 8]) {
    const army = hexArmy(a);
    assert.equal(armyTotal(army), (a * (a + 1)) / 2);
    assert.equal(army[FLAG], 1);
    assert.ok(Object.values(army).every((n) => n >= 1));
  }
});

test('every piece moves in six directions; scouts slide along all six rays', () => {
  const cfg = open(3);
  const s = scene(cfg, [['red', MINER, 0, 0], ['red', SCOUT, 1, 1], ['blue', FLAG, 0, 6], ['green', FLAG, 0, -6]]);
  const miner = reachable(s, cell(cfg, 0, 0));
  assert.deepEqual(miner.sort(), HEX_DIRS.map(([dq, dr]) => cell(cfg, dq, dr)).sort(), 'six neighbours');
  // the scout at (1,1): count cells along each ray by walking coordinates independently
  let expected = 0;
  for (const [dq, dr] of HEX_DIRS) {
    let q = 1 + dq, r = 1 + dr;
    while (cfg.topo.index.has(q * 1000 + r)) {
      const c = cell(cfg, q, r);
      const occupied = s.board[c];
      if (occupied) { if (occupied.owner !== 'red') expected++; break; }
      expected++; q += dq; r += dr;
    }
  }
  assert.equal(reachable(s, cell(cfg, 1, 1)).length, expected);
  assert.ok(expected > 20, 'scouts really do run along rays');
});

test('turn order goes around the table and skips eliminated players', () => {
  const cfg = open(3);
  // red scout sits next to blue's flag; green has a piece far away
  let s = scene(cfg, [
    ['red', SCOUT, 0, 2], ['red', FLAG, 0, 3], ['blue', FLAG, 0, 1], ['blue', MINER, -3, 3],
    ['green', FLAG, 0, -5], ['green', MARSHAL, -3, -1],
  ]);
  assert.equal(s.turn, 'red');
  // move red's scout away and back is not needed: capture blue's flag directly (adjacent: (0,2) -> (0,1))
  let r = applyMove(s, { from: cell(cfg, 0, 2), to: cell(cfg, 0, 1) });
  s = r.state;
  assert.equal(r.event.type, 'attack');
  assert.deepEqual(r.event.eliminated, [{ player: 'blue', reason: 'flag' }]);
  assert.equal(s.alive.blue, false);
  assert.ok(s.board.every((p) => !p || p.owner !== 'blue'), 'eliminated players\' pieces leave the board');
  assert.equal(s.turn, 'green', 'blue is skipped');
  assert.equal(s.winner, null);
  r = applyMove(s, legalMoves(s, 'green')[0] ? { from: legalMoves(s, 'green')[0].from, to: legalMoves(s, 'green')[0].to } : null);
  assert.equal(r.state.turn, 'red', 'then back to red');
});

test('a player with no legal move is eliminated, and the last player standing wins', () => {
  const cfg = open(3);
  // blue can only sit still (flag + bomb); green and red can move
  let s = scene(cfg, [
    ['red', MINER, 0, 0], ['red', FLAG, 0, 4], ['blue', FLAG, 2, 2], ['blue', BOMB, 3, 2],
    ['green', MINER, -2, -2], ['green', FLAG, -4, 0],
  ]);
  const r = applyMove(s, { from: cell(cfg, 0, 0), to: cell(cfg, 1, 0) });
  assert.deepEqual(r.event.eliminated, [{ player: 'blue', reason: 'blocked' }]);
  assert.equal(r.state.turn, 'green');
  assert.equal(r.state.alive.blue, false);
  // now red takes green's flag: only red remains
  s = scene(cfg, [['red', MINER, 0, 0], ['red', FLAG, 0, 4], ['green', FLAG, 1, 0], ['green', MINER, -3, 0]]);
  s = { ...s, alive: { red: true, blue: false, green: true } };
  const win = applyMove(s, { from: cell(cfg, 0, 0), to: cell(cfg, 1, 0) });
  assert.equal(win.state.winner, 'red');
  assert.deepEqual(win.state.winners, ['red']);
  assert.equal(win.state.winReason, 'flag');
  assert.ok(win.state.board.some((p) => p && p.owner === 'green'), 'the final position keeps the loser\'s pieces for the reveal');
});

test('allies block each other and share a victory', () => {
  const cfg = open(4, ['A', 'B', 'A', 'B']); // red+green vs blue+yellow; seating: red, blue, green, yellow
  assert.deepEqual(cfg.teams, { red: 'A', blue: 'B', green: 'A', yellow: 'B' });
  const s = scene(cfg, [
    ['red', MARSHAL, 0, 0], ['green', MINER, 1, 0], ['blue', MINER, -1, 0],
    ['red', FLAG, 0, 5], ['green', FLAG, 3, -5], ['blue', FLAG, -5, 5], ['yellow', FLAG, -2, -4], ['yellow', MINER, -4, 1],
  ]);
  const targets = reachable(s, cell(cfg, 0, 0));
  assert.ok(!targets.includes(cell(cfg, 1, 0)), 'cannot attack an ally');
  assert.ok(targets.includes(cell(cfg, -1, 0)), 'can attack an enemy');
  // eliminate both enemies by flag: only team A is left
  let st = scene(cfg, [['red', MINER, 0, 0], ['red', FLAG, 0, 5], ['green', FLAG, 3, -5], ['blue', FLAG, 1, 0], ['yellow', FLAG, -2, -4], ['yellow', MINER, -4, 1]]);
  st = applyMove(st, { from: cell(cfg, 0, 0), to: cell(cfg, 1, 0) }).state; // red captures blue's flag
  assert.equal(st.alive.blue, false);
  assert.equal(st.winner, null, 'yellow is still in the game');
  st.board[cell(cfg, 0, 1)] = { id: 1, owner: 'red', rank: MINER, revealed: false, moved: false };
  st.board[cell(cfg, -2, -3)] = null;
  st.board[cell(cfg, -2, -4)] = { id: 2, owner: 'yellow', rank: FLAG, revealed: false, moved: false };
  st.board[cell(cfg, -2, -3)] = { id: 3, owner: 'red', rank: MINER, revealed: false, moved: false };
  st = { ...st, turn: 'red' };
  const end = applyMove(st, { from: cell(cfg, -2, -3), to: cell(cfg, -2, -4) });
  assert.equal(end.state.winTeam, 'A');
  assert.deepEqual(end.state.winners, ['red', 'green']);
  assert.equal(end.state.winner, 'red');
});

test('the two-square rule is tracked per player', () => {
  const cfg = open(3);
  let s = scene(cfg, [['red', MINER, 0, 0], ['red', FLAG, 0, 5], ['blue', MINER, 2, 2], ['blue', FLAG, 4, 2], ['green', MINER, -2, -2], ['green', FLAG, -4, 0]]);
  const a = cell(cfg, 0, 0), b = cell(cfg, 1, 0), c2 = cell(cfg, 2, 2), c3 = cell(cfg, 2, 3), g1 = cell(cfg, -2, -2), g2 = cell(cfg, -1, -2);
  const play = (from, to) => { s = applyMove(s, { from, to }).state; };
  play(a, b); play(c2, c3); play(g1, g2);
  play(b, a); play(c3, c2); play(g2, g1);
  play(a, b); play(c2, c3); play(g1, g2);
  assert.ok(!legalMoves(s, 'red').some((m) => m.from === b && m.to === a), 'fourth shuttle for red is illegal');
  assert.ok(legalMoves(s, 'red').some((m) => m.from === b && m.to !== a));
});

test('random setups fill a camp with the full army', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    const cfg = makeHexConfig({ a: 7, players });
    for (const id of cfg.players) {
      const setup = randomSetupFor(cfg, id);
      const zone = new Set(cfg.topo.zones[id]);
      assert.equal(Object.keys(setup).length, armyTotal(cfg.army));
      const counts = {};
      for (const [c, r] of Object.entries(setup)) { assert.ok(zone.has(Number(c))); counts[r] = (counts[r] || 0) + 1; }
      assert.deepEqual(counts, Object.fromEntries(Object.entries(cfg.army)));
      const flag = Number(Object.keys(setup).find((c) => setup[c] === FLAG));
      assert.ok(cfg.topo.zoneRows[id].slice(0, 3).flat().includes(flag), 'the flag starts in the back rows');
    }
  }
});

test('re-rolling lakes keeps the players and teams', () => {
  const cfg = makeHexConfig({ a: 6, players: 4, teams: ['A', 'B', 'A', 'B'] });
  const again = rerollHexLakes(cfg);
  assert.deepEqual(again.teams, cfg.teams);
  assert.equal(again.players.length, 4);
  assert.ok(again.lakes.some(Boolean));
});

test('random games to the end for every player count, with and without teams', () => {
  const layouts = [
    [2, null], [3, null], [4, null], [5, null], [6, null],
    [4, ['A', 'B', 'A', 'B']], [6, ['A', 'A', 'B', 'B', 'C', 'C']], [6, ['A', 'B', 'A', 'B', 'A', 'B']], [5, ['A', 'B', 'A', 'B', null]],
  ];
  for (const [players, teams] of layouts) {
    const cfg = makeHexConfig({ a: 6, players, teams });
    const setups = Object.fromEntries(cfg.players.map((p) => [p, randomSetupFor(cfg, p)]));
    let s = createStateN(setups, cfg);
    const army = armyTotal(cfg.army);
    let plies = 0;
    while (!s.winner && plies < 6000) {
      const moves = legalMoves(s, s.turn);
      assert.ok(moves.length > 0, 'the player to move always has a move');
      assert.ok(s.alive[s.turn], 'only living players move');
      const m = moves[Math.floor(Math.random() * moves.length)];
      s = applyMove(s, m).state;
      plies++;
      if (plies % 50 === 0 || s.winner) {
        for (const p of cfg.players) {
          const onBoard = s.board.filter((x) => x && x.owner === p).length;
          if (s.alive[p]) assert.equal(onBoard + s.dead[p].length, army, `${p} keeps its books straight`);
          else if (!s.winner) assert.equal(onBoard, 0, 'eliminated players leave no pieces');
        }
        s.board.forEach((x, i) => { if (x) assert.ok(!s.topo.lake[i], 'no piece on a lake'); });
      }
    }
    if (s.winner) {
      assert.ok(s.winners.includes(s.winner));
      const teamsLeft = new Set(cfg.players.filter((p) => s.alive[p]).map((p) => s.teams[p]));
      assert.equal(teamsLeft.size, 1);
    }
  }
});

test('hasLegalMove agrees with legalMoves', () => {
  const cfg = makeHexConfig({ a: 6, players: 3 });
  const s = createStateN(Object.fromEntries(cfg.players.map((p) => [p, randomSetupFor(cfg, p)])), cfg);
  for (const p of cfg.players) assert.equal(hasLegalMove(s, p), legalMoves(s, p).length > 0);
});

test('a forfeit knocks the player out, keeps the turn where it was, and can end the game', async () => {
  const { forfeit } = await import('../src/game.js');
  const cfg = open(3);
  const s0 = scene(cfg, [
    ['red', MINER, 0, 0], ['red', FLAG, 0, 4], ['blue', MINER, 2, 2], ['blue', FLAG, 4, 2], ['green', MINER, -2, -2], ['green', FLAG, -4, 0],
  ]);
  assert.equal(s0.turn, 'red');
  // somebody else forfeits: the turn does not move
  let r = forfeit(s0, 'green', 'left');
  assert.deepEqual(r.eliminated, [{ player: 'green', reason: 'left' }]);
  assert.equal(r.state.turn, 'red');
  assert.equal(r.state.alive.green, false);
  assert.ok(r.state.board.every((p) => !p || p.owner !== 'green'), 'their pieces leave the board');
  assert.equal(r.state.winner, null);
  // the player whose turn it is forfeits: the next living player moves
  r = forfeit(s0, 'red', 'resigned');
  assert.equal(r.state.turn, 'blue');
  // a second forfeit leaves one player: game over, winner declared, pieces kept for the final reveal
  const end = forfeit(r.state, 'green', 'left').state;
  assert.equal(end.winner, 'blue');
  assert.deepEqual(end.winners, ['blue']);
  assert.equal(end.winReason, 'left');
  assert.ok(end.board.some((p) => p && p.owner === 'blue'));
  // forfeiting twice or after the end changes nothing
  assert.equal(forfeit(end, 'blue').state, end);
  assert.equal(forfeit(r.state, 'red').state, r.state);
});

test('a forfeit on a team board hands the win to the surviving team', async () => {
  const { forfeit } = await import('../src/game.js');
  const cfg = open(4, ['A', 'B', 'A', 'B']);
  const s = scene(cfg, [
    ['red', MINER, 0, 0], ['red', FLAG, 0, 5], ['green', MINER, 1, 0], ['green', FLAG, 3, -5],
    ['blue', MINER, -1, 0], ['blue', FLAG, -5, 5], ['yellow', MINER, -4, 1], ['yellow', FLAG, -2, -4],
  ]);
  let r = forfeit(s, 'blue', 'left').state;
  assert.equal(r.winner, null, 'yellow is still playing for team B');
  r = forfeit(r, 'yellow', 'left').state;
  assert.equal(r.winTeam, 'A');
  assert.deepEqual(r.winners, ['red', 'green']);
});

test('the first mover can be chosen', () => {
  const cfg = open(4);
  assert.equal(createStateN({}, cfg).turn, 'red');
  assert.equal(createStateN({}, cfg, { first: 'yellow' }).turn, 'yellow');
  assert.equal(createStateN({}, cfg, { first: 'nobody' }).turn, 'red');
});
