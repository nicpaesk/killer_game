/**
 * KILLER GAME - SMOKE TESTS
 * These tests verify that the basic server setup is working correctly.
 * They ensure that:
 * 1. The server can start
 * 2. HTTP requests are handled properly
 * 3. WebSocket connections can be established
 */

// Import Node.js test runner functions
import { describe, it, before, after } from 'node:test';

// Import assertion library for verifying test conditions
import assert from 'node:assert';

// Import our server creation function
import { createAppServer } from '../server.js';

// Import Socket.IO client for testing WebSocket connections
import { io as ClientIO } from 'socket.io-client';

/**
 * Test suite for Sprint 0 functionality
 * describe() groups related tests together
 */
describe('Sprint 0 Smoke Tests', () => {
  let server; // Will hold our server instance
  let baseURL; // Will hold the base URL of our test server

  /**
   * Setup function that runs before any tests in this suite
   * This starts our server on a random available port
   */
  before(async () => {
    // Create server instance using our function
    server = createAppServer();
    
    // Return a promise that resolves when the server is ready
    return new Promise((resolve, reject) => {
      // Start the server on a random available port (port 0 means "choose any available port")
      server.listen(0, () => {
        // Get the actual port that was assigned
        const port = server.address().port;
        // Create the base URL for our tests
        baseURL = `http://localhost:${port}`;
        console.log(`Test server running on ${baseURL}`);
        resolve();
      });
      
      // Handle potential server errors during startup
      server.on('error', reject);
    });
  });

  /**
   * Teardown function that runs after all tests in this suite
   * This stops our server to free up resources
   */
  after(async () => {
    return new Promise((resolve) => {
      if (server) {
        // Close the server and resolve the promise when done
        server.close(resolve);
      } else {
        // If there's no server, just resolve immediately
        resolve();
      }
    });
  });

  /**
   * Test that verifies the server can start without errors
   */
  it('should start the server without errors', () => {
    // Assert that the server instance was created
    assert(server !== undefined, 'Server should be defined');
    // Assert that the base URL was set
    assert(baseURL !== undefined, 'Base URL should be defined');
  });

  /**
   * Test that verifies HTTP requests are handled correctly
   */
  it('should handle HTTP requests', async () => {
    // Add a small delay to ensure server is fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Use the fetch API to make a request to our server
    const response = await fetch(baseURL);
    // Get the response text (HTML content)
    const text = await response.text();
    
    // Verify that the response status is 200 (OK)
    assert.strictEqual(response.status, 200);
    // Verify that the response contains the expected content
    assert.match(text, /Killer Game/);
    assert.match(text, /Hello World/);
  });

  /**
   * Test that verifies WebSocket connections can be established
   */
  it('should handle Socket.IO connections', async () => {
    // Return a promise that resolves when the connection is established
    return new Promise((resolve, reject) => {
      // Create a Socket.IO client that connects to our server
      const socket = ClientIO(baseURL, {
        transports: ['websocket'], // Force WebSocket transport for reliability
        timeout: 5000 // Set a 5-second timeout
      });
      
      // Handle successful connection
      socket.on('connect', () => {
        // Verify that the connection was established
        assert.strictEqual(socket.connected, true);
        // Disconnect the client
        socket.disconnect();
        // Resolve the promise (test passes)
        resolve();
      });
      
      // Handle connection errors
      socket.on('connect_error', (error) => {
        // Reject the promise with a descriptive error (test fails)
        reject(new Error(`Socket.IO connection failed: ${error.message}`));
      });
      
      // Add a timeout in case the connection never establishes
      setTimeout(() => {
        if (!socket.connected) {
          // If not connected after timeout, disconnect and fail the test
          socket.disconnect();
          reject(new Error('Socket.IO connection timeout after 5 seconds'));
        }
      }, 5000);
    });
  });
});