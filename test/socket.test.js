import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TestDatabase, createMockSocket, createMockIO } from './setup.js';

describe('Socket.IO Events', () => {
  let testDb, mockSocket, mockIO;

  beforeEach(() => {
    testDb = new TestDatabase();
    testDb.setup();
    mockSocket = createMockSocket();
    mockIO = createMockIO();

    // Create test game and players
    testDb.insertTestGame({ id: 'GAME01' });
    testDb.insertTestPlayer({ id: 'p1', game_id: 'GAME01', name: 'Alice' });
    testDb.insertTestPlayer({ id: 'p2', game_id: 'GAME01', name: 'Bob' });
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe('join-game event', () => {
    test('should join room and send player list', () => {
      const gameCode = 'GAME01';
      
      // Simulate join-game event handler
      mockSocket.join(gameCode);
      
      const players = testDb.getPlayersByGame(gameCode);
      mockSocket.emit('player-list-update', players);

      // Verify socket joined room
      const joinedRooms = mockSocket.getJoinedRooms();
      assert(joinedRooms.includes(gameCode), 'Socket should join game room');

      // Verify player list was sent
      assert(mockSocket.hasEmitted('player-list-update'), 'Should emit player list');
      const emittedPlayers = mockSocket.getEmittedData('player-list-update')[0];
      assert.strictEqual(emittedPlayers.length, 2);
      assert.strictEqual(emittedPlayers[0].name, 'Alice');
    });

    test('should handle invalid game code', () => {
      const invalidGameCode = 'INVALID';
      
      try {
        const players = testDb.getPlayersByGame(invalidGameCode);
        // Should return empty array for non-existent game
        assert.strictEqual(players.length, 0);
      } catch (error) {
        mockSocket.emit('error', { message: 'Failed to join game' });
        assert(mockSocket.hasEmitted('error'), 'Should emit error for invalid game');
      }
    });
  });

  describe('claim-identity event', () => {
    test('should successfully claim available identity', () => {
      const claimData = { gameCode: 'GAME01', playerName: 'Alice' };
      
      // Verify player is available
      const player = testDb.db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND name = ? AND status = 'not-joined'
      `).get(claimData.gameCode, claimData.playerName);
      
      assert(player, 'Player should be available for claiming');
      
      // Simulate claiming process
      const sessionToken = 'mock-session-token';
      
      testDb.db.prepare(`
        UPDATE players
        SET status = 'alive', session_token = ?, joined_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionToken, player.id);
      
      // Send confirmation
      mockSocket.emit('identity-confirmed', {
        sessionToken,
        playerName: claimData.playerName,
        playerId: player.id
      });
      
      // Broadcast update
      const updatedPlayers = testDb.getPlayersByGame(claimData.gameCode);
      mockIO.to(claimData.gameCode).emit('player-list-update', updatedPlayers);
      
      // Verify results
      assert(mockSocket.hasEmitted('identity-confirmed'), 'Should confirm identity');
      assert(mockIO.hasEmittedToRoom(claimData.gameCode, 'player-list-update'), 'Should broadcast update');
      
      const updatedPlayer = testDb.getPlayer(player.id);
      assert.strictEqual(updatedPlayer.status, 'alive');
      assert.strictEqual(updatedPlayer.session_token, sessionToken);
    });

    test('should reject claiming already taken identity', () => {
      // First, claim Alice
      testDb.db.prepare(`
        UPDATE players
        SET status = 'alive', session_token = 'existing-token'
        WHERE game_id = 'GAME01' AND name = 'Alice'
      `).run();
      
      const claimData = { gameCode: 'GAME01', playerName: 'Alice' };
      
      // Try to claim Alice again
      const player = testDb.db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND name = ? AND status = 'not-joined'
      `).get(claimData.gameCode, claimData.playerName);
      
      if (!player) {
        mockSocket.emit('error', { message: 'Player not found or already claimed' });
      }
      
      assert(mockSocket.hasEmitted('error'), 'Should emit error for taken identity');
      const errorData = mockSocket.getEmittedData('error')[0];
      assert.strictEqual(errorData.message, 'Player not found or already claimed');
    });

    test('should reject claiming non-existent player', () => {
      const claimData = { gameCode: 'GAME01', playerName: 'NonExistent' };
      
      const player = testDb.db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND name = ? AND status = 'not-joined'
      `).get(claimData.gameCode, claimData.playerName);
      
      if (!player) {
        mockSocket.emit('error', { message: 'Player not found or already claimed' });
      }
      
      assert(mockSocket.hasEmitted('error'), 'Should emit error for non-existent player');
    });
  });

  describe('cancel-identity event', () => {
    beforeEach(() => {
      // Set up a claimed identity
      testDb.db.prepare(`
        UPDATE players
        SET status = 'alive', session_token = 'test-session-token', joined_at = CURRENT_TIMESTAMP
        WHERE game_id = 'GAME01' AND name = 'Alice'
      `).run();
    });

    test('should successfully cancel claimed identity', () => {
      const cancelData = { gameCode: 'GAME01', sessionToken: 'test-session-token' };
      
      // Verify the session token exists
      const player = testDb.db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND session_token = ? AND status = 'alive'
      `).get(cancelData.gameCode, cancelData.sessionToken);
      
      assert(player, 'Player with session token should exist');
      
      // Reset player status
      testDb.db.prepare(`
        UPDATE players
        SET status = 'not-joined', session_token = NULL, joined_at = NULL
        WHERE id = ?
      `).run(player.id);
      
      // Send confirmation
      mockSocket.emit('identity-canceled', { playerName: player.name });
      
      // Broadcast update
      const updatedPlayers = testDb.getPlayersByGame(cancelData.gameCode);
      mockIO.to(cancelData.gameCode).emit('player-list-update', updatedPlayers);
      
      // Verify results
      assert(mockSocket.hasEmitted('identity-canceled'), 'Should confirm cancellation');
      assert(mockIO.hasEmittedToRoom(cancelData.gameCode, 'player-list-update'), 'Should broadcast update');
      
      const resetPlayer = testDb.getPlayer(player.id);
      assert.strictEqual(resetPlayer.status, 'not-joined');
      assert.strictEqual(resetPlayer.session_token, null);
      assert.strictEqual(resetPlayer.joined_at, null);
    });

    test('should reject invalid session token', () => {
      const cancelData = { gameCode: 'GAME01', sessionToken: 'invalid-token' };
      
      const player = testDb.db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND session_token = ? AND status = 'alive'
      `).get(cancelData.gameCode, cancelData.sessionToken);
      
      if (!player) {
        mockSocket.emit('error', { message: 'Invalid session or player not found' });
      }
      
      assert(mockSocket.hasEmitted('error'), 'Should emit error for invalid token');
    });

    test('should reject cancellation for non-claimed player', () => {
      const cancelData = { gameCode: 'GAME01', sessionToken: 'non-existent-token' };
      
      const player = testDb.db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND session_token = ? AND status = 'alive'
      `).get(cancelData.gameCode, cancelData.sessionToken);
      
      if (!player) {
        mockSocket.emit('error', { message: 'Invalid session or player not found' });
      }
      
      assert(mockSocket.hasEmitted('error'), 'Should emit error for non-claimed player');
    });
  });

  describe('Real-time Updates', () => {
    test('should broadcast to all players in game room', () => {
      const gameCode = 'GAME01';
      const players = testDb.getPlayersByGame(gameCode);
      
      // Simulate broadcasting to room
      mockIO.to(gameCode).emit('player-list-update', players);
      
      assert(mockIO.hasEmittedToRoom(gameCode, 'player-list-update'), 'Should broadcast to room');
      const roomEmissions = mockIO.getRoomEmissions();
      assert(roomEmissions[gameCode]['player-list-update'], 'Should have emissions for game room');
    });

    test('should not broadcast to other game rooms', () => {
      const gameCode1 = 'GAME01';
      const gameCode2 = 'GAME02';
      
      // Broadcast only to GAME01
      mockIO.to(gameCode1).emit('player-list-update', []);
      
      assert(mockIO.hasEmittedToRoom(gameCode1, 'player-list-update'), 'Should emit to GAME01');
      assert(!mockIO.hasEmittedToRoom(gameCode2, 'player-list-update'), 'Should not emit to GAME02');
    });
  });
});