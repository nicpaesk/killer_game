import express from 'express';
import { createServer as createHttpServer } from 'http'; // Rename the import
import { Server as SocketIOServer } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createAppServer() { 
  const app = express();
  const server = createHttpServer(app);
  const io = new SocketIOServer(server);

  // Store io on the server for testing
  server.io = io;

  app.use(express.static(join(__dirname, 'public')));

  io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);
  });

  return server;
}

// Only start server if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createAppServer(); 
  server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
  });
}