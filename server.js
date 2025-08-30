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

// Generate unique game code (4 letters + 2 numbers)
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

// Get server URL for join links
function getServerUrl(req) {
  const protocol = req.secure ? 'https' : 'http';
  const host = req.get('host');
  return `${protocol}://${host}`;
}

// API Endpoints
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
    const playersArray = playerNames.split('\n').filter(name => name.trim() !== '');
    const tasksArray = tasks.split('\n').filter(task => task.trim() !== '');
    
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

// Serve game page
app.get('/game/:gameCode', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'game.html'));
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  
  // Handle joining a game room
  socket.on('join-game', (gameCode) => {
    try {
      console.log(`User ${socket.id} joining game ${gameCode}`);
      socket.join(gameCode);
      
      // Fetch players for this game
      const players = db.prepare(`
        SELECT id, name, status, session_token, joined_at
        FROM players
        WHERE game_id = ?
        ORDER BY name
      `).all(gameCode);
      
      // Send player list to the client that just joined
      socket.emit('player-list-update', players);
    } catch (error) {
      console.error('Error joining game:', error);
      socket.emit('error', { message: 'Failed to join game' });
    }
  });
  
  // Handle claiming player identity
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
      console.error('Error claiming identity:', error);
      socket.emit('error', { message: 'Failed to claim identity' });
    }
  });
  
  // Handle canceling player identity
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
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});