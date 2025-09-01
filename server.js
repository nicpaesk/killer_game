// server.js
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import fileUpload from 'express-fileupload';

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const server = createServer(app);
const io = new SocketIOServer(server);

// Database initialization
const db = new Database('database.db');

// Create tables if they don't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    creator_session TEXT,
    status TEXT,
    task_pool TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    game_id TEXT,
    name TEXT,
    session_token TEXT,
    target_id TEXT,
    assassin_id TEXT,
    task TEXT,
    status TEXT,
    joined_at DATETIME
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS kill_history (
    id TEXT PRIMARY KEY,
    game_id TEXT,
    killer_id TEXT,
    victim_id TEXT,
    task TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Add joined_at column if it doesn't exist (for migration)
try {
  db.exec(`ALTER TABLE players ADD COLUMN joined_at DATETIME`);
} catch (error) {
  // Column already exists, ignore error
}

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  useTempFiles: false,
  tempFileDir: '/tmp/'
}));

// ----------------------------
// In-memory socket bookkeeping
// ----------------------------
// Maps to send socket-targeted events (kill challenge, direct DM)
const sessionToSocket = new Map(); // session_token -> socket.id
const playerToSocket = new Map();  // player.id -> socket.id

// ----------------------------
// Prepared DB helpers
// ----------------------------
const getGameById = db.prepare(`SELECT * FROM games WHERE id = ?`);
const listAlivePlayers = db.prepare(`SELECT * FROM players WHERE game_id = ? AND status = 'alive' ORDER BY name`);
const listAllPlayers = db.prepare(`SELECT id, name, status, session_token, joined_at, target_id, task FROM players WHERE game_id = ? ORDER BY name`);
const getPlayerBySession = db.prepare(`SELECT * FROM players WHERE session_token = ?`);
const getPlayerById = db.prepare(`SELECT * FROM players WHERE id = ?`);
const updatePlayerTargetAndTask = db.prepare(`UPDATE players SET target_id = ?, task = ? WHERE id = ?`);
const setGameStatus = db.prepare(`UPDATE games SET status = ? WHERE id = ?`);
const setPlayerStatus = db.prepare(`UPDATE players SET status = ? WHERE id = ?`);
const setPlayerTargetOnly = db.prepare(`UPDATE players SET target_id = ? WHERE id = ?`);
const setPlayerTaskOnly = db.prepare(`UPDATE players SET task = ? WHERE id = ?`);

// ----------------------------
// Utility helpers
// ----------------------------
function generateGameCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numbers = '0123456789';

  let code = '';
  for (let i = 0; i < 4; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  for (let i = 0; i < 2; i++) {
    code += numbers.charAt(Math.floor(Math.random() * numbers.length));
  }

  return code;
}

function getServerUrl(req) {
  const protocol = req.secure ? 'https' : 'http';
  const host = req.get('host');
  return `${protocol}://${host}`;
}

/**
 * Shuffle an array (Fisher-Yates) and return the new array.
 * We'll use the shuffled order to create a single cycle: arr[i] -> arr[(i+1)%n]
 */
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Default fallback tasks used if task_pool in DB is missing/invalid.
 */
const DEFAULT_TASKS = [
  "Make them say their favorite movie.",
  "Get them to high-five you.",
  "Borrow a pen from them.",
  "Make them take a selfie with you.",
  "Get them to say the word 'banana'."
];

// ----------------------------
// API Endpoints
// ----------------------------
app.post('/api/create-game', (req, res) => {
  try {
    let { playerNames, tasks } = req.body;

    // Handle file upload for tasks
    if (req.files && req.files.taskFile) {
      const taskFile = req.files.taskFile;
      const fileContent = taskFile.data.toString('utf8');
      tasks = fileContent; // Override tasks with file content
    }

    if (!playerNames || !tasks) {
      return res.status(400).json({ error: 'Player names and tasks are required' });
    }

    // Parse player names and tasks
    const playersArray = playerNames.split('\n').map(s => s.trim()).filter(name => name !== '');
    const tasksArray = tasks.split('\n').map(s => s.trim()).filter(t => t !== '');

    if (playersArray.length === 0 || tasksArray.length === 0) {
      return res.status(400).json({ error: 'At least one player and one task are required' });
    }

    // Generate unique game code
    let gameCode;
    do {
      gameCode = generateGameCode();
    } while (db.prepare('SELECT id FROM games WHERE id = ?').get(gameCode));

    // Generate creator token
    const creatorToken = crypto.randomBytes(16).toString('hex');

    // Insert game into database
    const insertGame = db.prepare(`
      INSERT INTO games (id, creator_session, status, task_pool)
      VALUES (?, ?, ?, ?)
    `);

    insertGame.run(gameCode, creatorToken, 'lobby', JSON.stringify(tasksArray));

    // Insert players into database
    const insertPlayer = db.prepare(`
      INSERT INTO players (id, game_id, name, status)
      VALUES (?, ?, ?, ?)
    `);

    for (const playerName of playersArray) {
      const playerId = uuidv4();
      insertPlayer.run(playerId, gameCode, playerName.trim(), 'not-joined');
    }

    // Create join URL
    const joinUrl = `${getServerUrl(req)}/game/${gameCode}`;

    res.json({ gameCode, creatorToken, joinUrl });
  } catch (error) {
    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

app.get('/game/:gameCode', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'game.html'));
});

app.get('/api/game-summary', (req, res) => {
  try {
    const { gameCode } = req.query;
    if (!gameCode) return res.status(400).json({ error: 'Missing game code' });

    const game = getGameById.get(gameCode);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    // Winner
    const alivePlayers = listAlivePlayers.all(gameCode);
    const winner = alivePlayers.length === 1 ? alivePlayers[0] : null;

    // Kill history with player names
    const historyRows = db.prepare(`
      SELECT kh.*, k.name AS killer_name, v.name AS victim_name, k.session_token AS killer_session_token
      FROM kill_history kh
      LEFT JOIN players k ON kh.killer_id = k.id
      LEFT JOIN players v ON kh.victim_id = v.id
      WHERE kh.game_id = ?
      ORDER BY kh.timestamp ASC
    `).all(gameCode);

    // Kill count per player
    const killCountArr = [];
    const players = db.prepare(`SELECT name FROM players WHERE game_id = ?`).all(gameCode);
    players.forEach(p => {
      // Count kills for this player
      const count = historyRows.filter(h => h.killer_name === p.name).length;
      killCountArr.push({ name: p.name, count });
    });
    // Sort descending by count, then by name
    killCountArr.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

    const sessionToken = req.query.sessionToken || null;
    let currentPlayer = null;
    if (sessionToken) {
      currentPlayer = db.prepare(`SELECT name FROM players WHERE session_token = ? AND game_id = ?`)
                        .get(sessionToken, gameCode);
    }

    res.json({
      winner_name: winner ? winner.name : null,
      kill_history: historyRows,
      kill_count: killCountArr,
      current_player_name: currentPlayer ? currentPlayer.name : null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get game summary' });
  }
});

// ----------------------------
// Socket.IO handlers
// ----------------------------
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // When a client joins a room to see the lobby
  socket.on('join-game', (gameCode) => {
    try {
      socket.join(gameCode);
      // Send the players list for the room to the requester
      const players = db.prepare(`
        SELECT id, name, status, session_token, joined_at
        FROM players
        WHERE game_id = ?
        ORDER BY name
      `).all(gameCode);

      socket.emit('player-list-update', players);
    } catch (error) {
      console.error('Error joining game:', error);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });

  // Claim identity (player picks their name and joins as 'alive')
  socket.on('claim-identity', (data) => {
    try {
      const { gameCode, playerName } = data;

      console.log(`User ${socket.id} claiming identity ${playerName} in game ${gameCode}`);

      // Check if player exists and is not already claimed
      const player = db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND name = ? AND status = 'not-joined'
      `).get(gameCode, playerName);

      if (!player) {
        socket.emit('error', { message: 'Player not found or already claimed' });
        return;
      }

      // Generate session token
      const sessionToken = crypto.randomBytes(16).toString('hex');

      // Update player status, session token, and joined_at timestamp
      db.prepare(`
        UPDATE players
        SET status = 'alive', session_token = ?, joined_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(sessionToken, player.id);

      // Send confirmation to the claiming client
      socket.emit('identity-confirmed', {
        sessionToken,
        playerName,
        playerId: player.id
      });

      // Store mapping so we can DM this socket later
      sessionToSocket.set(sessionToken, socket.id);
      playerToSocket.set(player.id, socket.id);
      socket.data.sessionToken = sessionToken;
      socket.data.playerId = player.id;
      socket.data.gameCode = gameCode;

      // Fetch updated player list and broadcast to room
      const updatedPlayers = db.prepare(`
        SELECT id, name, status, session_token, joined_at
        FROM players
        WHERE game_id = ?
        ORDER BY name
      `).all(gameCode);

      io.to(gameCode).emit('player-list-update', updatedPlayers);

    } catch (error) {
      console.error('Error claiming identity:', error);
      socket.emit('error', { message: 'Failed to claim identity' });
    }
  });

  // Cancel identity (player leaves / frees name)
  socket.on('cancel-identity', (data) => {
    try {
      const { gameCode, sessionToken } = data;

      console.log(`User ${socket.id} canceling identity in game ${gameCode}`);

      // Verify the session token exists and belongs to this game
      const player = db.prepare(`
        SELECT * FROM players
        WHERE game_id = ? AND session_token = ? AND status = 'alive'
      `).get(gameCode, sessionToken);

      if (!player) {
        socket.emit('error', { message: 'Invalid session or player not found' });
        return;
      }

      // Reset player status
      db.prepare(`
        UPDATE players
        SET status = 'not-joined', session_token = NULL, joined_at = NULL
        WHERE id = ?
      `).run(player.id);

      // Remove socket mappings for this session/player
      sessionToSocket.delete(sessionToken);
      playerToSocket.delete(player.id);
      if (socket.data) {
        socket.data.sessionToken = null;
        socket.data.playerId = null;
      }

      // Send confirmation to the canceling client
      socket.emit('identity-canceled', {
        playerName: player.name
      });

      // Fetch updated player list
      const updatedPlayers = db.prepare(`
        SELECT id, name, status, session_token, joined_at
        FROM players
        WHERE game_id = ?
        ORDER BY name
      `).all(gameCode);

      // Broadcast updated player list to all clients in the game room
      io.to(gameCode).emit('player-list-update', updatedPlayers);

    } catch (error) {
      console.error('Error canceling identity:', error);
      socket.emit('error', { message: 'Failed to cancel identity' });
    }
  });

  // -------------------------
  // SPRINT 2: Start Game
  // -------------------------
  socket.on('start-game', (data) => {
    try {
      const { gameCode, creatorToken } = data || {};

      const game = getGameById.get(gameCode);
      if (!game) {
        socket.emit('error', { message: 'Game not found.' });
        return;
      }

      // Validate creator
      if (game.creator_session !== creatorToken) {
        socket.emit('error', { message: 'Only the creator can start the game.' });
        return;
      }

      if (game.status === 'active' || game.status === 'finished') {
        // Already active/finished; still notify clients
        io.to(gameCode).emit('game-started');
        return;
      }

      // Get current alive players
      const alive = listAlivePlayers.all(gameCode);
      if (alive.length < 2) {
        socket.emit('error', { message: 'Need at least 2 alive players to start.' });
        return;
      }

      // Parse tasks from game's task_pool
      let tasks;
      try {
        tasks = Array.isArray(JSON.parse(game.task_pool)) ? JSON.parse(game.task_pool) : [];
      } catch {
        tasks = [];
      }
      if (!tasks || tasks.length === 0) tasks = DEFAULT_TASKS;

      // Create a single cycle by shuffling the list and assigning next as target
      const ids = alive.map(p => p.id);
      const shuffled = shuffleArray(ids);

      // --- NEW: assign distinct tasks if possible ---
      // Build tasksToAssign array of length shuffled.length
      let tasksToAssign = [];
      const numPlayers = shuffled.length;
      const poolSize = tasks.length;

      if (poolSize >= numPlayers) {
        // Enough tasks for everyone: give unique tasks
        const shuffledTasks = shuffleArray(tasks);
        tasksToAssign = shuffledTasks.slice(0, numPlayers);
      } else {
        // Not enough tasks: give each available task uniquely first, then fill the rest randomly
        const shuffledTasks = shuffleArray(tasks);
        tasksToAssign = shuffledTasks.slice(); // unique tasks first
        while (tasksToAssign.length < numPlayers) {
          // pick random from the pool (repeats allowed only because pool is too small)
          const pick = tasks[Math.floor(Math.random() * poolSize)];
          tasksToAssign.push(pick);
        }
        // Optional: shuffle the final tasksToAssign so the unique-first order isn't predictable
        tasksToAssign = shuffleArray(tasksToAssign);
      }

      const tx = db.transaction(() => {
        for (let i = 0; i < shuffled.length; i++) {
          const pid = shuffled[i];
          const targetId = shuffled[(i + 1) % shuffled.length];
          const assignedTask = tasksToAssign[i];
          updatePlayerTargetAndTask.run(targetId, assignedTask, pid);
        }
        setGameStatus.run('active', gameCode);
      });
      tx();

      // Broadcast that game started
      io.to(gameCode).emit('game-started');

      // DM each alive player with their assignment (private)
      const updatedAlive = listAlivePlayers.all(gameCode);
      for (const p of updatedAlive) {
        const sockId = playerToSocket.get(p.id);
        if (!sockId) continue; // player offline — they'll fetch on reconnect
        const target = p.target_id ? getPlayerById.get(p.target_id) : null;
        io.to(sockId).emit('your-assignment', {
          target: target ? { id: target.id, name: target.name } : null,
          task: p.task || null
        });
      }

    } catch (error) {
      console.error('start-game error:', error);
      socket.emit('error', { message: 'Failed to start game.' });
    }
  });

  // -------------------------
  // SPRINT 2: Claim Kill (killer -> asks server to challenge target)
  // -------------------------
  socket.on('claim-kill', (data) => {
    try {
      const sessionToken = (data && (data.sessionToken || data.session_token));
      const gameCode = data && (data.gameCode || data.game_code);
      if (!sessionToken) {
        socket.emit('error', { message: 'Missing session token.' });
        return;
      }
      const killer = getPlayerBySession.get(sessionToken);
      if (!killer) {
        socket.emit('error', { message: 'Invalid session.' });
        return;
      }
      if (killer.game_id !== gameCode) {
        socket.emit('error', { message: 'Session does not belong to this game.' });
        return;
      }
      if (killer.status !== 'alive') {
        socket.emit('error', { message: 'Eliminated players cannot claim kills.' });
        return;
      }
      if (!killer.target_id) {
        socket.emit('error', { message: 'You have no target.' });
        return;
      }

      const target = getPlayerById.get(killer.target_id);
      if (!target) {
        socket.emit('error', { message: 'Target not found.' });
        return;
      }
      if (target.status !== 'alive') {
        socket.emit('error', { message: 'Target is already eliminated.' });
        return;
      }

      const targetSocketId = playerToSocket.get(target.id);
      if (!targetSocketId) {
        socket.emit('error', { message: 'Target is offline. Try again later.' });
        return;
      }

      // Send challenge only to target
      io.to(targetSocketId).emit('kill-challenge', {
        killer_id: killer.id,
        killer_name: killer.name,
        task: killer.task
      });

    } catch (error) {
      console.error('claim-kill error:', error);
      socket.emit('error', { message: 'Claim-kill failed.' });
    }
  });

  // -------------------------
  // SPRINT 2: Resolve Kill (target confirms or denies)
  // -------------------------
  socket.on('resolve-kill', (data) => {
    try {
      const sessionToken = (data && (data.sessionToken || data.session_token));
      const killer_id = data && (data.killer_id || data.killerId);
      const answer = data && data.answer;
      if (!sessionToken) {
        socket.emit('error', { message: 'Missing session token.' });
        return;
      }
      const target = getPlayerBySession.get(sessionToken);
      if (!target) {
        socket.emit('error', { message: 'Invalid session.' });
        return;
      }
      if (target.status !== 'alive') {
        socket.emit('error', { message: 'Only alive targets can resolve a kill.' });
        return;
      }

      const killer = getPlayerById.get(killer_id);
      if (!killer) {
        socket.emit('error', { message: 'Killer not found.' });
        return;
      }
      if (killer.status !== 'alive') {
        socket.emit('error', { message: 'Killer is no longer alive.' });
        return;
      }
      if (killer.target_id !== target.id) {
        socket.emit('error', { message: 'You are not their current target.' });
        return;
      }

      const killerSocketId = playerToSocket.get(killer.id);

      if (String(answer).toLowerCase() !== 'confirm') {
        // Denied -> notify killer only
        if (killerSocketId) {
          io.to(killerSocketId).emit('kill-denied');
        }
        return;
      }

      // Confirmed -> process elimination
      // Determine new target for killer: usually target.target_id, but if target.target_id === killer.id (2-player-cycle),
      // then killer gets no target (null) and will be the winner if no other alive players remain.
      const targetNextId = target.target_id || null;
      const newTargetForKiller = (targetNextId === killer.id) ? null : targetNextId;

      const tx = db.transaction(() => {
        // Mark target eliminated
        setPlayerStatus.run('eliminated', target.id);
        // Reassign killer's target
        setPlayerTargetOnly.run(newTargetForKiller, killer.id);
        // Transfer task to killer
        setPlayerTaskOnly.run(target.task || null, killer.id);

        // --- NEW: insert into kill history ---
        const insertKill = db.prepare(`
          INSERT INTO kill_history (id, game_id, killer_id, victim_id, task)
          VALUES (?, ?, ?, ?, ?)
        `);
        insertKill.run(uuidv4(), target.game_id, killer.id, target.id, target.task || null);
      });
      tx();

      // Broadcast updated roster to the whole game room so lobby & graveyard update immediately
      const updatedPlayers = db.prepare(`
        SELECT id, name, status, session_token, joined_at
        FROM players
        WHERE game_id = ?
        ORDER BY name
      `).all(target.game_id);
      io.to(target.game_id).emit('player-list-update', updatedPlayers);

      // Broadcast elimination to room
      io.to(target.game_id).emit('player-eliminated', {
        name: target.name,
        id: target.id
      });

      // Notify eliminated player (so client switches to graveyard)
      const targetSocketId = playerToSocket.get(target.id);
      if (targetSocketId) {
        io.to(targetSocketId).emit('you-eliminated');
      }

      // Inform killer of new target + task
      if (killerSocketId) {
        const updatedKiller = getPlayerById.get(killer.id);
        const newTarget = updatedKiller.target_id ? getPlayerById.get(updatedKiller.target_id) : null;
        io.to(killerSocketId).emit('new-target', {
          target: newTarget ? { id: newTarget.id, name: newTarget.name } : null,
          task: updatedKiller.task || null
        });
      }

      // Check for game over: only one alive left
      const aliveNow = listAlivePlayers.all(target.game_id);
      if (aliveNow.length === 1) {
        const winner = aliveNow[0];
        setGameStatus.run('finished', target.game_id);
        io.to(target.game_id).emit('game-over', {
          winner_id: winner.id,
          winner_name: winner.name
        });

        // --- NEW: instruct clients to navigate to victory page ---
        io.to(target.game_id).emit('navigate-victory', { gameCode: target.game_id });
      }

    } catch (error) {
      console.error('resolve-kill error:', error);
      socket.emit('error', { message: 'Resolve-kill failed.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // cleanup any maps that referenced this socket.id
    for (const [session, sid] of sessionToSocket.entries()) {
      if (sid === socket.id) sessionToSocket.delete(session);
    }
    for (const [pid, sid] of playerToSocket.entries()) {
      if (sid === socket.id) playerToSocket.delete(pid);
    }
  });

});

// ----------------------------
// Server start
// ----------------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
