/**
 * KILLER GAME - SERVER SETUP
 * This file sets up the Express server with Socket.IO for real-time communication.
 * It serves static files and handles WebSocket connections.
 */

// Import necessary modules using ES6 import syntax (enabled by "type": "module" in package.json)
import express from 'express'; // Web framework for handling HTTP requests
import { createServer as createHttpServer } from 'http'; // Node.js HTTP module for creating a server
import { Server as SocketIOServer } from 'socket.io'; // Socket.IO for real-time bidirectional communication
import { fileURLToPath } from 'url'; // Utility functions for working with file URLs
import { dirname, join } from 'path'; // Utilities for working with file and directory paths

/**
 * Convert the current file's URL to a file path and get its directory name
 * This is needed because ES modules don't have __dirname by default
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Function to create and configure the application server
 * This is exported for testing purposes
 */
export function createAppServer() {
  // Create an Express application instance
  const app = express();
  
  // Create an HTTP server using Node's http module and our Express app
  const server = createHttpServer(app);
  
  // Create a Socket.IO server instance attached to the HTTP server
  // This allows handling WebSocket connections alongside HTTP requests
  const io = new SocketIOServer(server);

  /**
   * Serve static files from the 'public' directory
   * When a client requests a file (like index.html, CSS, JS, images),
   * Express will look for it in the 'public' folder
   */
  app.use(express.static(join(__dirname, 'public')));

  /**
   * Handle Socket.IO connection events
   * This event fires whenever a client connects to the server via WebSocket
   */
  io.on('connection', (socket) => {
    // Each client gets a unique socket ID
    console.log(`A user connected: ${socket.id}`);
    
    // In future sprints, we'll add more event handlers here for:
    // - Player joining the game
    // - Game actions (attacks, moves, etc.)
    // - Disconnection handling
  });

  // Return the server instance so it can be used elsewhere (like in tests)
  return server;
}

/**
 * Start the server only if this file is executed directly
 * This check prevents the server from starting when we import this file for testing
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  // Create the server instance
  const server = createAppServer();
  
  // Start listening on port 3000
  server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
    console.log('Open this URL in a browser to test the game');
  });
}