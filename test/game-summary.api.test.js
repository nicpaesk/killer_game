import { test, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'http';
import { app, io } from '../server.js'; // also import io

let server;
let baseUrl;

before(() => {
  return new Promise(resolve => {
    server = http.createServer(app);
    server.listen(0, () => {
      const { port } = server.address();
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

after(() => {
  return new Promise(resolve => {
    if (io) {
      io.close(); // 👈 closes all socket.io resources
    }
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
});

test('GET /api/game-summary returns 400 for invalid game code', async () => {
  const res = await fetch(`${baseUrl}/api/game-summary?gameCode=@@bad`);
  assert.strictEqual(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /Invalid game code/);
});

test('GET /api/game-summary works without sessionToken', async () => {
  const createRes = await fetch(`${baseUrl}/api/create-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerNames: 'Alice\nBob',
      tasks: 'Task1\nTask2'
    })
  });
  const { gameCode } = await createRes.json();

  const res = await fetch(`${baseUrl}/api/game-summary?gameCode=${gameCode}`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(body.kill_history));
  assert.ok(Array.isArray(body.kill_count));
});

test('GET /api/game-summary works with sessionToken', async () => {
  const createRes = await fetch(`${baseUrl}/api/create-game`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerNames: 'Charlie\nDana',
      tasks: 'Task1'
    })
  });
  const { gameCode } = await createRes.json();

  const fakeSession = 'sess-fake';
  const res = await fetch(
    `${baseUrl}/api/game-summary?gameCode=${gameCode}&sessionToken=${fakeSession}`
  );
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.ok(Array.isArray(body.kill_history));
  assert.ok(body.kill_history.every(row => 'is_own_kill' in row));
});
