// test/kill-history.test.js
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TestDatabase } from './setup.js';
import { v4 as uuidv4 } from 'uuid';

describe('Kill History Tracking', () => {
  let tdb;

  beforeEach(() => { tdb = new TestDatabase(); tdb.setup(); });
  afterEach(() => { tdb.cleanup(); });

  test('records kills with killer/victim/task and orders by timestamp ASC', () => {
    const gameId = 'G55';
    tdb.insertTestGame({ id: gameId, status: 'active' });
    tdb.insertTestPlayer({ id: 'p1', game_id: gameId, name: 'Alice', status: 'alive' });
    tdb.insertTestPlayer({ id: 'p2', game_id: gameId, name: 'Bob', status: 'alive' });
    tdb.insertTestPlayer({ id: 'p3', game_id: gameId, name: 'Charlie', status: 'alive' });

    const stmt = tdb.db.prepare("INSERT INTO kill_history (id, game_id, killer_id, victim_id, task, timestamp) VALUES (?, ?, ?, ?, ?, ?)");
    stmt.run(uuidv4(), gameId, 'p1', 'p2', 'Task A', '2024-01-01T10:00:00Z');
    stmt.run(uuidv4(), gameId, 'p3', 'p1', 'Task B', '2024-01-01T11:00:00Z');

    const rows = tdb.db.prepare(`
      SELECT kh.*, k.name AS killer_name, v.name AS victim_name
      FROM kill_history kh
      LEFT JOIN players k ON kh.killer_id = k.id
      LEFT JOIN players v ON kh.victim_id = v.id
      WHERE kh.game_id = ?
      ORDER BY kh.timestamp ASC
    `).all(gameId);

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].killer_name, 'Alice');
    assert.strictEqual(rows[0].victim_name, 'Bob');
    assert.strictEqual(rows[0].task, 'Task A');
    assert.strictEqual(rows[1].killer_name, 'Charlie');
    assert.strictEqual(rows[1].victim_name, 'Alice');
  });
});

