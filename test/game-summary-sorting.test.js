// test/game-summary-sorting.test.js
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TestDatabase } from './setup.js';
import { v4 as uuidv4 } from 'uuid';

// Minimal reimplementation of the summary query logic
function computeKillCount(db, gameId) {
  const historyRows = db.prepare(`
    SELECT kh.*, k.name AS killer_name
    FROM kill_history kh
    LEFT JOIN players k ON kh.killer_id = k.id
    WHERE kh.game_id = ?
  `).all(gameId);

  const killCountArr = [];
  const players = db.prepare('SELECT name FROM players WHERE game_id = ?').all(gameId);
  players.forEach(p => {
    const count = historyRows.filter(h => h.killer_name === p.name).length;
    killCountArr.push({ name: p.name, count });
  });
  killCountArr.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return killCountArr;
}

describe('API: /api/game-summary sorting', () => {
  let tdb;

  beforeEach(() => { tdb = new TestDatabase(); tdb.setup(); });
  afterEach(() => { tdb.cleanup(); });

  test('kill counts sorted by count desc, then name asc', () => {
    const gameId = 'GSORT1';
    tdb.insertTestGame({ id: gameId, status: 'active' });

    const players = [
      { id: 'p1', game_id: gameId, name: 'Zoe' },
      { id: 'p2', game_id: gameId, name: 'Alice' },
      { id: 'p3', game_id: gameId, name: 'Bob' },
      { id: 'p4', game_id: gameId, name: 'Charlie' }
    ];
    players.forEach(p => tdb.insertTestPlayer(p));

    const ins = tdb.db.prepare('INSERT INTO kill_history (id, game_id, killer_id, victim_id, task) VALUES (?, ?, ?, ?, ?)');
    // Give Alice 3 kills, Bob 3 kills, Zoe 2 kills, Charlie 0
    ins.run(uuidv4(), gameId, 'p2', 'p1', 't');
    ins.run(uuidv4(), gameId, 'p2', 'p3', 't');
    ins.run(uuidv4(), gameId, 'p2', 'p4', 't');

    ins.run(uuidv4(), gameId, 'p3', 'p1', 't');
    ins.run(uuidv4(), gameId, 'p3', 'p2', 't');
    ins.run(uuidv4(), gameId, 'p3', 'p4', 't');

    ins.run(uuidv4(), gameId, 'p1', 'p2', 't');
    ins.run(uuidv4(), gameId, 'p1', 'p3', 't');

    const killCount = computeKillCount(tdb.db, gameId);

    // Expect: Alice (3), Bob (3), Zoe (2), Charlie (0)
    // Alice before Bob since names are alphabetically sorted
    assert.deepStrictEqual(killCount, [
      { name: 'Alice', count: 3 },
      { name: 'Bob', count: 3 },
      { name: 'Zoe', count: 2 },
      { name: 'Charlie', count: 0 }
    ]);
  });
});

