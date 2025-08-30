import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { createAppServer } from '../server.js';
import { io as ClientIO } from 'socket.io-client';

describe('Sprint 0 Smoke Tests', () => {
  let server;
  let baseURL;

  before(async () => {
    // Create server on a different port for testing
    server = createAppServer();
    
    return new Promise((resolve) => {
      server.listen(0, () => {
        const port = server.address().port;
        baseURL = `http://localhost:${port}`;
        console.log(`Test server running on ${baseURL}`);
        resolve();
      });
    });
  });

  after(async () => {
    return new Promise((resolve) => {
      if (server) {
        server.close(resolve);
      } else {
        resolve();
      }
    });
  });

  it('should start the server without errors', () => {
    assert(server !== undefined, 'Server should be defined');
  });

  it('should handle HTTP requests', async () => {
    const response = await fetch(baseURL);
    const text = await response.text();
    
    assert.strictEqual(response.status, 200);
    assert.match(text, /Killer Game/);
    assert.match(text, /Hello World/);
  });

  it('should handle Socket.IO connections', () => {
    return new Promise((resolve, reject) => {
      const socket = ClientIO(baseURL, {
        transports: ['websocket'], // Force WebSocket transport
        timeout: 2000
      });
      
      socket.on('connect', () => {
        assert.strictEqual(socket.connected, true);
        socket.disconnect();
        resolve();
      });
      
      socket.on('connect_error', (error) => {
        socket.disconnect();
        reject(new Error(`Socket.IO connection failed: ${error.message}`));
      });
      
      // Add timeout in case connection never establishes
      setTimeout(() => {
        if (socket.connected === false) {
          socket.disconnect();
          reject(new Error('Socket.IO connection timeout'));
        }
      }, 3000);
    });
  });
});