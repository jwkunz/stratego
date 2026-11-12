import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceScore, totalScore, FLAG, SPY, SCOUT, MARSHAL, BOMB } from '../src/game.js';

test('pieces score their rank; bombs and the flag are not scored', () => {
  assert.equal(pieceScore(SPY), 1);
  assert.equal(pieceScore(SCOUT), 2);
  assert.equal(pieceScore(MARSHAL), 10);
  assert.equal(pieceScore(BOMB), 0);
  assert.equal(pieceScore(FLAG), 0);
});

test('totalScore sums a loss list', () => {
  assert.equal(totalScore([]), 0);
  assert.equal(totalScore([10, 2, 2, BOMB, 1]), 15);
});
