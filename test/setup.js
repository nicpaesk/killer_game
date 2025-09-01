import { beforeEach, afterEach } from 'node:test';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Test database utilities
export class TestDatabase {
  constructor() {
    this.dbPath = ':memory:';
    this.db = null;
  }

  setup() {
    this.db = new Database(this.dbPath);
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        creator_session TEXT,
        status TEXT,
        task_pool TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.exec(`
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
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kill_history (
        id TEXT PRIMARY KEY,
        game_id TEXT,
        killer_id TEXT,
        victim_id TEXT,
        task TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    return this.db;
  }

  cleanup() {
    if (this.db) {
      this.db.close();
    }
  }

  insertTestGame(gameData) {
    const defaultData = {
      id: 'TEST01',
      creator_session: 'test-creator-token',
      status: 'lobby',
      task_pool: JSON.stringify(['Test Task 1', 'Test Task 2'])
    };
    
    const data = { ...defaultData, ...gameData };
    
    return this.db.prepare(`
      INSERT INTO games (id, creator_session, status, task_pool)
      VALUES (?, ?, ?, ?)
    `).run(data.id, data.creator_session, data.status, data.task_pool);
  }

  insertTestPlayer(playerData) {
    const defaultData = {
      id: 'test-player-1',
      game_id: 'TEST01',
      name: 'Alice',
      status: 'not-joined',
      session_token: null,
      target_id: null,
      assassin_id: null,
      task: null,
      joined_at: null
    };

    const data = { ...defaultData, ...playerData };

    return this.db.prepare(`
      INSERT INTO players (id, game_id, name, status, session_token, target_id, assassin_id, task, joined_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.id, data.game_id, data.name, data.status, 
      data.session_token, data.target_id, data.assassin_id, 
      data.task, data.joined_at
    );
  }

  getGame(id) {
    return this.db.prepare('SELECT * FROM games WHERE id = ?').get(id);
  }

  getPlayer(id) {
    return this.db.prepare('SELECT * FROM players WHERE id = ?').get(id);
  }

  getPlayersByGame(gameId) {
    return this.db.prepare('SELECT * FROM players WHERE game_id = ? ORDER BY name').all(gameId);
  }
}

// Mock request/response utilities
export function createMockReq(body = {}, files = null) {
  return {
    body,
    files,
    secure: false,
    get: (header) => {
      if (header === 'host') return 'localhost:3000';
      return undefined;
    }
  };
}

export function createMockRes() {
  const res = {
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.jsonData = data;
      return this;
    },
    send: function(data) {
      this.sentData = data;
      return this;
    },
    sendFile: function(filePath) {
      this.sentFile = filePath;
      return this;
    },
    statusCode: 200,
    jsonData: null,
    sentData: null,
    sentFile: null
  };
  return res;
}

// Socket.IO mock utilities
export function createMockSocket() {
  const emittedEvents = {};
  const joinedRooms = [];

  return {
    id: 'mock-socket-id',
    emit: function(event, data) {
      if (!emittedEvents[event]) {
        emittedEvents[event] = [];
      }
      emittedEvents[event].push(data);
    },
    join: function(room) {
      joinedRooms.push(room);
    },
    // Test utilities
    getEmittedEvents: () => emittedEvents,
    getJoinedRooms: () => joinedRooms,
    hasEmitted: (event) => !!emittedEvents[event],
    getEmittedData: (event) => emittedEvents[event] || []
  };
}

export function createMockIO() {
  const roomEmissions = {};

  return {
    to: function(room) {
      return {
        emit: function(event, data) {
          if (!roomEmissions[room]) {
            roomEmissions[room] = {};
          }
          if (!roomEmissions[room][event]) {
            roomEmissions[room][event] = [];
          }
          roomEmissions[room][event].push(data);
        }
      };
    },
    // Test utilities
    getRoomEmissions: () => roomEmissions,
    hasEmittedToRoom: (room, event) => !!(roomEmissions[room] && roomEmissions[room][event])
  };
}
