import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'assert';
import { TestDatabase } from './setup.js';

describe('Database Operations', () => {
  let testDb;

  beforeEach(() => {
    testDb = new TestDatabase();
    testDb.setup();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe('Games Table', () => {
    test('should create a new game', () => {
      const gameData = {
        id: 'ABCD12',
        creator_session: 'creator-token-123',
        status: 'lobby',
        task_pool: JSON.stringify(['Task 1', 'Task 2'])
      };

      testDb.insertTestGame(gameData);
      const retrievedGame = testDb.getGame('ABCD12');

      assert.strictEqual(retrievedGame.id, 'ABCD12');
      assert.strictEqual(retrievedGame.creator_session, 'creator-token-123');
      assert.strictEqual(retrievedGame.status, 'lobby');
      assert.deepStrictEqual(JSON.parse(retrievedGame.task_pool), ['Task 1', 'Task 2']);
      assert(retrievedGame.created_at); // Should have timestamp
    });

    test('should enforce unique game IDs', () => {
      testDb.insertTestGame({ id: 'SAME01' });
      
      // Better-sqlite3 throws a different error format
      assert.throws(() => {
        testDb.insertTestGame({ id: 'SAME01' });
      }, /UNIQUE/); // More generic pattern
    });
  });

  describe('Players Table', () => {
    beforeEach(() => {
      // Create a test game first
      testDb.insertTestGame({ id: 'GAME01' });
    });

    test('should create a new player', () => {
      const playerData = {
        id: 'player-1',
        game_id: 'GAME01',
        name: 'Alice',
        status: 'not-joined'
      };

      testDb.insertTestPlayer(playerData);
      const retrievedPlayer = testDb.getPlayer('player-1');

      assert.strictEqual(retrievedPlayer.id, 'player-1');
      assert.strictEqual(retrievedPlayer.game_id, 'GAME01');
      assert.strictEqual(retrievedPlayer.name, 'Alice');
      assert.strictEqual(retrievedPlayer.status, 'not-joined');
      assert.strictEqual(retrievedPlayer.session_token, null);
    });

    test('should update player status when claiming identity', () => {
      testDb.insertTestPlayer({
        id: 'player-1',
        game_id: 'GAME01',
        name: 'Bob',
        status: 'not-joined'
      });

      // Simulate claiming identity
      const sessionToken = 'session-token-123';
      testDb.db.prepare(`
        UPDATE players 
        SET status = 'alive', session_token = ?, joined_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionToken, 'player-1');

      const updatedPlayer = testDb.getPlayer('player-1');
      assert.strictEqual(updatedPlayer.status, 'alive');
      assert.strictEqual(updatedPlayer.session_token, sessionToken);
      assert(updatedPlayer.joined_at);
    });

    test('should reset player when canceling identity', () => {
      // First, create a claimed player
      testDb.insertTestPlayer({
        id: 'player-1',
        game_id: 'GAME01',
        name: 'Charlie',
        status: 'alive',
        session_token: 'token-123'
      });

      // Simulate canceling identity
      testDb.db.prepare(`
        UPDATE players 
        SET status = 'not-joined', session_token = NULL, joined_at = NULL
        WHERE id = ?
      `).run('player-1');

      const resetPlayer = testDb.getPlayer('player-1');
      assert.strictEqual(resetPlayer.status, 'not-joined');
      assert.strictEqual(resetPlayer.session_token, null);
      assert.strictEqual(resetPlayer.joined_at, null);
    });

    test('should retrieve players by game', () => {
      const players = [
        { id: 'p1', game_id: 'GAME01', name: 'Charlie' },
        { id: 'p2', game_id: 'GAME01', name: 'Alice' },
        { id: 'p3', game_id: 'GAME01', name: 'Bob' }
      ];

      players.forEach(player => testDb.insertTestPlayer(player));

      const gamePlayers = testDb.getPlayersByGame('GAME01');
      assert.strictEqual(gamePlayers.length, 3);
      
      // Sort by name to ensure consistent order for assertions
      const sortedPlayers = gamePlayers.sort((a, b) => a.name.localeCompare(b.name));
      assert.strictEqual(sortedPlayers[0].name, 'Alice');
      assert.strictEqual(sortedPlayers[1].name, 'Bob');
      assert.strictEqual(sortedPlayers[2].name, 'Charlie');
    });
  });

  describe('Database Schema', () => {
    test('should have joined_at column in players table', () => {
      const columns = testDb.db.prepare("PRAGMA table_info(players)").all();
      const joinedAtColumn = columns.find(col => col.name === 'joined_at');
      
      assert(joinedAtColumn, 'joined_at column should exist');
      assert.strictEqual(joinedAtColumn.type.toUpperCase(), 'DATETIME');
    });

    test('should have created_at column in games table', () => {
      const columns = testDb.db.prepare("PRAGMA table_info(games)").all();
      const createdAtColumn = columns.find(col => col.name === 'created_at');
      
      assert(createdAtColumn, 'created_at column should exist');
      assert.strictEqual(createdAtColumn.type.toUpperCase(), 'DATETIME');
    });
  });
});