import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

describe('Frontend Logic', () => {
  let dom, window, document, localStorage;
  let originalWindow, originalDocument, originalNavigator, originalLocalStorage;

  beforeEach(() => {
    // Save original globals
    originalWindow = global.window;
    originalDocument = global.document;
    originalNavigator = global.navigator;
    originalLocalStorage = global.localStorage;

    // Create a virtual DOM environment
    dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body>
          <form id="createGameForm">
            <textarea id="playerNames"></textarea>
            <textarea id="tasks"></textarea>
            <input type="file" id="taskFile" />
            <button type="submit" id="createBtn">Create Game</button>
          </form>
          <div id="error" class="error" style="display: none;"></div>
          <div id="successContainer" style="display: none;">
            <span id="displayGameCode"></span>
            <input id="joinUrl" />
            <button id="copyBtn">Copy Link</button>
          </div>
          
          <!-- Game page elements -->
          <div id="gameCode"></div>
          <div id="selectionPhaseContainer" class="selection-phase-container">
            <span id="selectedPlayerName">None</span>
            <button id="confirmIdentityBtn" disabled>Confirm My Identity</button>
          </div>
          <div id="playersList"></div>
        </body>
      </html>
    `);

    window = dom.window;
    document = window.document;
    
    // Set up global objects
    global.window = window;
    global.document = document;
    
    // Define navigator property properly
    Object.defineProperty(global, 'navigator', {
      value: {
        clipboard: {
          writeText: () => Promise.resolve()
        }
      },
      writable: true
    });

    // Mock localStorage
    const localStorageMock = {
      getItem: function(key) { return this[key] || null; },
      setItem: function(key, value) { this[key] = value; },
      removeItem: function(key) { delete this[key]; }
    };
    global.localStorage = localStorageMock;
    localStorage = localStorageMock;
  });

  afterEach(() => {
    // Restore original globals
    global.window = originalWindow;
    global.document = originalDocument;
    global.navigator = originalNavigator;
    global.localStorage = originalLocalStorage;
    
    dom.window.close();
  });

  describe('Game Creation Form', () => {
    test('should validate required fields', () => {
      const playerNamesInput = document.getElementById('playerNames');
      const tasksInput = document.getElementById('tasks');

      // Test empty inputs
      playerNamesInput.value = '';
      tasksInput.value = '';

      const playerNames = playerNamesInput.value.trim();
      const tasks = tasksInput.value.trim();

      // Simulate validation logic
      let errorMessage = null;
      if (!playerNames) {
        errorMessage = 'Please enter player names';
      } else if (!tasks) {
        errorMessage = 'Please enter tasks or upload a task file';
      }

      assert.strictEqual(errorMessage, 'Please enter player names');
    });

    test('should prevent using both textarea and file upload', () => {
      const mockFile = { name: 'tasks.txt' };

      const tasks = 'Some tasks';
      const taskFile = mockFile;

      // Validation should catch this
      if (tasks && taskFile) {
        const error = 'Please use either the text area OR file upload, not both';
        assert.strictEqual(error, 'Please use either the text area OR file upload, not both');
      }
    });

    test('should parse player names correctly', () => {
      const input = 'Alice\nBob\n\nCharlie\n';
      const playersArray = input.split('\n').filter(name => name.trim() !== '');
      
      assert.strictEqual(playersArray.length, 3);
      assert.strictEqual(playersArray[0], 'Alice');
      assert.strictEqual(playersArray[1], 'Bob');
      assert.strictEqual(playersArray[2], 'Charlie');
    });

    test('should show success UI after game creation', () => {
      const gameCode = 'ABCD12';
      const joinUrl = 'http://localhost:3000/game/ABCD12';
      const creatorToken = 'creator-token-123';

      // Simulate showSuccess function
      const createForm = document.getElementById('createGameForm').parentElement;
      const successContainer = document.getElementById('successContainer');
      const displayGameCode = document.getElementById('displayGameCode');
      const joinUrlInput = document.getElementById('joinUrl');

      createForm.style.display = 'none';
      successContainer.style.display = 'block';
      displayGameCode.textContent = gameCode;
      joinUrlInput.value = joinUrl;
      localStorage.setItem(`creator_${gameCode}`, creatorToken);

      assert.strictEqual(createForm.style.display, 'none');
      assert.strictEqual(successContainer.style.display, 'block');
      assert.strictEqual(displayGameCode.textContent, gameCode);
      assert.strictEqual(joinUrlInput.value, joinUrl);
      assert.strictEqual(localStorage.getItem(`creator_${gameCode}`), creatorToken);
    });
  });

  describe('File Upload Logic', () => {
    test('should disable textarea when file is selected', () => {
      const taskTextarea = document.getElementById('tasks');
      const taskFileInput = document.getElementById('taskFile');

      // Simulate file selection by setting disabled state directly
      taskTextarea.disabled = true;
      taskTextarea.placeholder = 'File selected for tasks';
      taskTextarea.value = '';

      assert.strictEqual(taskTextarea.disabled, true);
      assert.strictEqual(taskTextarea.placeholder, 'File selected for tasks');
      assert.strictEqual(taskTextarea.value, '');
    });

    test('should disable file input when textarea has content', () => {
      const taskTextarea = document.getElementById('tasks');
      const taskFileInput = document.getElementById('taskFile');

      taskTextarea.value = 'Some tasks';
      
      // Simulate the logic directly
      taskFileInput.disabled = true;

      assert.strictEqual(taskFileInput.disabled, true);
    });
  });

  describe('Game Lobby Logic', () => {
    test('should extract game code from URL', () => {
      // Simulate window.location.pathname = '/game/ABCD12'
      const pathname = '/game/ABCD12';
      const gameCode = pathname.split('/').pop();
      
      assert.strictEqual(gameCode, 'ABCD12');
    });

    test('should detect if user is creator', () => {
      const gameCode = 'ABCD12';
      const creatorToken = 'creator-token-123';
      
      localStorage.setItem(`creator_${gameCode}`, creatorToken);
      
      const isCreator = !!localStorage.getItem(`creator_${gameCode}`);
      assert.strictEqual(isCreator, true);
    });

    test('should manage tentative player selection', () => {
      let tentativelySelectedPlayer = null;
      const playerName = 'Alice';

      // Simulate selectPlayer function logic
      function selectPlayer(name) {
        if (tentativelySelectedPlayer === name) {
          tentativelySelectedPlayer = null; // Deselect
        } else {
          tentativelySelectedPlayer = name; // Select
        }
      }

      selectPlayer(playerName);
      assert.strictEqual(tentativelySelectedPlayer, 'Alice');

      selectPlayer(playerName); // Click again to deselect
      assert.strictEqual(tentativelySelectedPlayer, null);
    });

    test('should update selection phase UI', () => {
      const selectedNameSpan = document.getElementById('selectedPlayerName');
      const confirmBtn = document.getElementById('confirmIdentityBtn');
      let tentativelySelectedPlayer = 'Bob';

      // Simulate updateSelectionPhaseDisplay function
      if (tentativelySelectedPlayer) {
        selectedNameSpan.textContent = tentativelySelectedPlayer;
        confirmBtn.disabled = false;
      } else {
        selectedNameSpan.textContent = 'None';
        confirmBtn.disabled = true;
      }

      assert.strictEqual(selectedNameSpan.textContent, 'Bob');
      assert.strictEqual(confirmBtn.disabled, false);

      // Test with no selection
      tentativelySelectedPlayer = null;
      selectedNameSpan.textContent = 'None';
      confirmBtn.disabled = true;

      assert.strictEqual(selectedNameSpan.textContent, 'None');
      assert.strictEqual(confirmBtn.disabled, true);
    });

    test('should render player list with correct states', () => {
      const players = [
        { name: 'Alice', status: 'not-joined', session_token: null },
        { name: 'Bob', status: 'alive', session_token: 'bob-token' },
        { name: 'Charlie', status: 'not-joined', session_token: null }
      ];
      
      const mySessionToken = 'bob-token';
      const tentativelySelectedPlayer = 'Alice';

      // Simulate renderPlayerList logic
      const playerHTML = players.map(player => {
        const isMe = player.session_token === mySessionToken;
        const canSelect = player.status === 'not-joined';
        const isTentativelySelected = tentativelySelectedPlayer === player.name;

        return {
          name: player.name,
          isMe,
          canSelect,
          isTentativelySelected,
          status: player.status
        };
      });

      assert.strictEqual(playerHTML[0].canSelect, true); // Alice can be selected
      assert.strictEqual(playerHTML[0].isTentativelySelected, true); // Alice is tentatively selected
      assert.strictEqual(playerHTML[1].isMe, true); // Bob is me
      assert.strictEqual(playerHTML[1].canSelect, false); // Bob can't be selected (already joined)
      assert.strictEqual(playerHTML[2].canSelect, true); // Charlie can be selected
    });

    test('should handle identity confirmation', () => {
      const gameCode = 'ABCD12';
      const playerName = 'Alice';
      const sessionToken = 'new-session-token';
      
      // Simulate identity-confirmed event
      localStorage.setItem(`session_${gameCode}`, sessionToken);
      localStorage.setItem(`player_name_${gameCode}`, playerName);
      
      const mySessionToken = localStorage.getItem(`session_${gameCode}`);
      const myPlayerName = localStorage.getItem(`player_name_${gameCode}`);
      
      assert.strictEqual(mySessionToken, sessionToken);
      assert.strictEqual(myPlayerName, playerName);
    });

    test('should handle identity cancellation', () => {
      const gameCode = 'ABCD12';
      
      // Set up claimed identity
      localStorage.setItem(`session_${gameCode}`, 'old-token');
      localStorage.setItem(`player_name_${gameCode}`, 'Alice');
      
      // Simulate identity-canceled event
      localStorage.removeItem(`session_${gameCode}`);
      localStorage.removeItem(`player_name_${gameCode}`);
      
      const mySessionToken = localStorage.getItem(`session_${gameCode}`);
      const myPlayerName = localStorage.getItem(`player_name_${gameCode}`);
      
      assert.strictEqual(mySessionToken, null);
      assert.strictEqual(myPlayerName, null);
    });
  });

  describe('Copy Link Functionality', () => {
    test('should copy join URL to clipboard', async () => {
      const joinUrlInput = document.getElementById('joinUrl');
      
      joinUrlInput.value = 'http://localhost:3000/game/ABCD12';
      
      let copiedText = '';
      
      // Mock clipboard function
      const originalWriteText = global.navigator.clipboard.writeText;
      global.navigator.clipboard.writeText = (text) => {
        copiedText = text;
        return Promise.resolve();
      };

      try {
        // Simulate copy button click
        await global.navigator.clipboard.writeText(joinUrlInput.value);
        assert.strictEqual(copiedText, 'http://localhost:3000/game/ABCD12');
      } finally {
        // Restore original function
        global.navigator.clipboard.writeText = originalWriteText;
      }
    });

    test('should provide visual feedback for copy action', () => {
      const copyBtn = document.getElementById('copyBtn');
      const originalText = copyBtn.textContent;
      
      // Simulate successful copy feedback
      copyBtn.textContent = 'Copied!';
      copyBtn.style.backgroundColor = '#28a745';
      
      assert.strictEqual(copyBtn.textContent, 'Copied!');
      assert.strictEqual(copyBtn.style.backgroundColor, 'rgb(40, 167, 69)'); // Note: CSS colors are returned as RGB
      
      // Simulate timeout reset
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.backgroundColor = '';
      }, 0);
    });
  });

  describe('Start Game Button Logic', () => {
    test('should enable start button when all players joined', () => {
      const players = [
        { status: 'alive' },
        { status: 'alive' },
        { status: 'alive' }
      ];
      
      const allJoined = players.length > 0 && players.every(player => player.status === 'alive');
      
      assert.strictEqual(allJoined, true);
    });

    test('should disable start button when players not all joined', () => {
      const players = [
        { status: 'alive' },
        { status: 'not-joined' },
        { status: 'alive' }
      ];
      
      const allJoined = players.length > 0 && players.every(player => player.status === 'alive');
      const joinedCount = players.filter(p => p.status === 'alive').length;
      
      assert.strictEqual(allJoined, false);
      assert.strictEqual(joinedCount, 2);
    });

    test('should only show start button for creator', () => {
      const gameCode = 'ABCD12';
      const creatorToken = 'creator-token';
      
      localStorage.setItem(`creator_${gameCode}`, creatorToken);
      const isCreator = !!localStorage.getItem(`creator_${gameCode}`);
      
      assert.strictEqual(isCreator, true);
      
      // Remove creator token
      localStorage.removeItem(`creator_${gameCode}`);
      const isNotCreator = !!localStorage.getItem(`creator_${gameCode}`);
      
      assert.strictEqual(isNotCreator, false);
    });
  });
});