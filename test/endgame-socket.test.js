// test/endgame-socket.test.js
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TestDatabase, createMockIO } from './setup.js';

describe('End-game transitions', () => {
  let tdb, io;

  beforeEach(() => { tdb = new TestDatabase(); tdb.setup(); io = createMockIO(); });
  afterEach(() => { tdb.cleanup(); });

  function resolveKillAndMaybeEndGame(db, io, gameId, killerId, targetId, targetNextId) {
    db.prepare("UPDATE players SET status = 'eliminated' WHERE id = ?").run(targetId);
    const newTargetForKiller = (targetNextId === killerId) ? null : targetNextId;
    db.prepare("UPDATE players SET target_id = ? WHERE id = ?").run(newTargetForKiller, killerId);

    const aliveNow = db.prepare("SELECT * FROM players WHERE game_id = ? AND status = 'alive'").all(gameId);
    if (aliveNow.length === 1) {
      const winner = aliveNow[0];
      db.prepare("UPDATE games SET status = 'finished' WHERE id = ?").run(gameId);
      io.to(gameId).emit('game-over', { winner_id: winner.id, winner_name: winner.name });
      io.to(gameId).emit('navigate-victory', { gameCode: gameId });
    }
  }

  test('emits navigate-victory when last kill leaves one alive', () => {
    const gameId = 'G12345';
    tdb.insertTestGame({ id: gameId, status: 'active' });

    tdb.insertTestPlayer({ id: 'A', game_id: gameId, name: 'Alice', status: 'alive', target_id: 'B' });
    tdb.insertTestPlayer({ id: 'B', game_id: gameId, name: 'Bob', status: 'alive', target_id: 'A' });

    resolveKillAndMaybeEndGame(tdb.db, io, gameId, 'A', 'B', 'A');

    assert.strictEqual(io.hasEmittedToRoom(gameId, 'game-over'), true);
    assert.strictEqual(io.hasEmittedToRoom(gameId, 'navigate-victory'), true);
    const events = io.getRoomEmissions();
    const gameOverPayload = events[gameId]['game-over'][0];
    assert.strictEqual(gameOverPayload.winner_name, 'Alice');

    const game = tdb.getGame(gameId);
    assert.strictEqual(game.status, 'finished');
  });
});

