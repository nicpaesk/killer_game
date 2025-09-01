import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TestDatabase } from './setup.js';
import { v4 as uuidv4 } from 'uuid';

function computeGameSummary(db, gameCode, sessionToken = null) {
  const alivePlayers = db.prepare(`SELECT * FROM players WHERE game_id = ? AND status = 'alive' ORDER BY name`).all(gameCode);
  const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;

  const historyRows = db.prepare(`
    SELECT kh.*, k.name AS killer_name, v.name AS victim_name,
           (k.session_token = ?) AS is_own_kill
    FROM kill_history kh
    LEFT JOIN players k ON kh.killer_id = k.id
    LEFT JOIN players v ON kh.victim_id = v.id
    WHERE kh.game_id = ?
    ORDER BY kh.timestamp ASC
  `).all(sessionToken || null, gameCode);

  const killCountArr = [];
  const players = db.prepare('SELECT name FROM players WHERE game_id = ?').all(gameCode);
  players.forEach(p => {
    const count = historyRows.filter(h => h.killer_name === p.name).length;
    killCountArr.push({ name: p.name, count });
  });
  killCountArr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  let currentPlayer = null;
  if (sessionToken) {
    currentPlayer = db.prepare('SELECT name FROM players WHERE session_token = ? AND game_id = ?').get(sessionToken, gameCode);
  }

  return {
    winner_name: winner ? winner.name : null,
    kill_history: historyRows,
    kill_count: killCountArr,
    current_player_name: currentPlayer ? currentPlayer.name : null
  };
}

describe('API: /api/game-summary logic', () => {
  let tdb;

  beforeEach(() => { tdb = new TestDatabase(); tdb.setup(); });
  afterEach(() => { tdb.cleanup(); });

  test('computes winner, kill history, and rankings', () => {
    const gameId = 'GAME77';
    tdb.insertTestGame({ id: gameId, status: 'active' });

    const players = [
      { id: 'p1', game_id: gameId, name: 'Alice', status: 'alive', session_token: 'sess-alice' },
      { id: 'p2', game_id: gameId, name: 'Bob', status: 'alive', session_token: 'sess-bob' },
      { id: 'p3', game_id: gameId, name: 'Charlie', status: 'alive', session_token: 'sess-charlie' }
    ];
    players.forEach(p => tdb.insertTestPlayer(p));

    const ins = tdb.db.prepare('INSERT INTO kill_history (id, game_id, killer_id, victim_id, task) VALUES (?, ?, ?, ?, ?)');
    ins.run(uuidv4(), gameId, 'p2', 'p3', 'Task X'); // Bob kills Charlie
    ins.run(uuidv4(), gameId, 'p1', 'p2', 'Task Y'); // Alice kills Bob

    tdb.db.prepare("UPDATE players SET status = 'eliminated' WHERE id IN ('p2','p3')").run();

    const summary = computeGameSummary(tdb.db, gameId, 'sess-bob');

    assert.strictEqual(summary.winner_name, 'Alice');
    assert.strictEqual(summary.current_player_name, 'Bob');
    assert.strictEqual(summary.kill_history[0].killer_name, 'Bob');
    assert.strictEqual(summary.kill_history[0].is_own_kill, 1); // Bob is current player
    assert.strictEqual(summary.kill_history[1].killer_name, 'Alice');
    assert.strictEqual(summary.kill_history[1].is_own_kill, 0); // Alice is not current player


    assert.deepStrictEqual(summary.kill_count, [
      { name: 'Alice', count: 1 },
      { name: 'Bob', count: 1 },
      { name: 'Charlie', count: 0 }
    ]);
  });
});
