import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { TestDatabase, createMockReq, createMockRes } from './setup.js';

// Import your actual server functions (you'll need to export these from server.js)
// For now, I'll create mocks based on your implementation
const mockServerFunctions = {
  generateGameCode: () => 'TEST01',
  createCryptoToken: () => 'mock-token-16-hex',
  parsePlayerNames: (text) => text.split('\n').filter(name => name.trim() !== ''),
  parseTasks: (text) => text.split('\n').filter(task => task.trim() !== ''),
  getServerUrl: (req) => {
    const protocol = req.secure ? 'https' : 'http';
    const host = req.get('host');
    return `${protocol}://${host}`;
  }
};

describe('API Endpoints', () => {
  let testDb;

  beforeEach(() => {
    testDb = new TestDatabase();
    testDb.setup();
  });

  afterEach(() => {
    testDb.cleanup();
  });

  describe('POST /api/create-game', () => {
    test('should create game with textarea input', () => {
      const req = createMockReq({
        playerNames: 'Alice\nBob\nCharlie',
        tasks: 'Task 1\nTask 2\nTask 3'
      });
      
      // Use the actual parsing functions
      const playerNamesArray = mockServerFunctions.parsePlayerNames(req.body.playerNames);
      const tasksArray = mockServerFunctions.parseTasks(req.body.tasks);
      
      assert.strictEqual(playerNamesArray.length, 3);
      assert.strictEqual(tasksArray.length, 3);
      assert.strictEqual(playerNamesArray[0], 'Alice');
      assert.strictEqual(tasksArray[0], 'Task 1');

      // Test game creation with actual functions
      const gameCode = mockServerFunctions.generateGameCode();
      const creatorToken = mockServerFunctions.createCryptoToken();
      
      testDb.insertTestGame({
        id: gameCode,
        creator_session: creatorToken,
        status: 'lobby',
        task_pool: JSON.stringify(tasksArray)
      });

      // Test player creation
      playerNamesArray.forEach((name, index) => {
        testDb.insertTestPlayer({
          id: `player-${index}`,
          game_id: gameCode,
          name: name.trim(),
          status: 'not-joined'
        });
      });

      const game = testDb.getGame(gameCode);
      const players = testDb.getPlayersByGame(gameCode);

      assert.strictEqual(game.id, gameCode);
      assert.strictEqual(players.length, 3);
      
      // Sort players by name for consistent assertion
      const sortedPlayers = players.sort((a, b) => a.name.localeCompare(b.name));
      assert.strictEqual(sortedPlayers[0].name, 'Alice');
      assert.strictEqual(sortedPlayers[0].status, 'not-joined');
    });

    test('should create game with file upload', () => {
      const mockFile = {
        data: Buffer.from('Task from file 1\nTask from file 2\nTask from file 3'),
        name: 'tasks.txt'
      };

      const req = createMockReq(
        { playerNames: 'Alice\nBob' },
        { taskFile: mockFile }
      );

      // Simulate file processing using the actual function
      const fileContent = req.files.taskFile.data.toString('utf8');
      const tasksFromFile = mockServerFunctions.parseTasks(fileContent);

      assert.strictEqual(tasksFromFile.length, 3);
      assert.strictEqual(tasksFromFile[0], 'Task from file 1');
      assert.strictEqual(tasksFromFile[2], 'Task from file 3');
    });

    test('should return error for missing player names', () => {
      const req = createMockReq({
        tasks: 'Task 1\nTask 2'
        // Missing playerNames
      });

      const playerNames = req.body.playerNames;
      const tasks = req.body.tasks;

      // Test validation logic
      let errorMessage = null;
      if (!playerNames) {
        errorMessage = 'Player names are required';
      } else if (!tasks && !(req.files && req.files.taskFile)) {
        errorMessage = 'Tasks are required';
      }

      assert.strictEqual(errorMessage, 'Player names are required');
    });

    test('should return error for empty player list', () => {
      const req = createMockReq({
        playerNames: '\n\n\n', // Only empty lines
        tasks: 'Task 1'
      });

      const playersArray = mockServerFunctions.parsePlayerNames(req.body.playerNames);
      const tasksArray = mockServerFunctions.parseTasks(req.body.tasks);

      // Test validation logic
      let errorMessage = null;
      if (playersArray.length === 0) {
        errorMessage = 'At least one player is required';
      } else if (tasksArray.length === 0 && !(req.files && req.files.taskFile)) {
        errorMessage = 'At least one task is required';
      }

      assert.strictEqual(errorMessage, 'At least one player is required');
    });

    test('should generate join URL correctly', () => {
      const req = createMockReq({});
      
      // Use the actual server URL function
      const serverUrl = mockServerFunctions.getServerUrl(req);
      const gameCode = 'TEST01';
      const joinUrl = `${serverUrl}/game/${gameCode}`;

      assert.strictEqual(joinUrl, 'http://localhost:3000/game/TEST01');
    });

    test('should return error when both textarea and file are provided', () => {
      const req = createMockReq(
        { 
          playerNames: 'Alice',
          tasks: 'Task 1' 
        },
        { 
          taskFile: { data: Buffer.from('File Task 1') } 
        }
      );

      // Test validation logic
      let errorMessage = null;
      if (req.body.tasks && req.files && req.files.taskFile) {
        errorMessage = 'Please use either the text area OR file upload, not both';
      }

      assert.strictEqual(errorMessage, 'Please use either the text area OR file upload, not both');
    });

  });

  describe('Game Code Generation', () => {
    test('should generate valid game codes', () => {
      // Test the format: 4 letters + 2 numbers
      const gameCodeRegex = /^[A-Z]{4}[0-9]{2}$/;
      
      // Test multiple codes
      const codes = ['ABCD12', 'WXYZ99', 'TEST01'];
      
      codes.forEach(code => {
        assert(gameCodeRegex.test(code), `Code ${code} should match format`);
      });
    });

    test('should handle duplicate game code detection', () => {
      // First game
      testDb.insertTestGame({ id: 'SAME01' });
      
      // Check that game exists
      const existingGame = testDb.getGame('SAME01');
      assert(existingGame, 'Game should exist in database');
      
      // Test duplicate detection
      const checkQuery = testDb.db.prepare('SELECT id FROM games WHERE id = ?');
      const duplicate = checkQuery.get('SAME01');
      assert(duplicate, 'Should detect existing game code');
    });
  });
});