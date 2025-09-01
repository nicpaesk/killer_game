// test/victory-page.test.js
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Victory Page', () => {
  let dom, window, document;

  function loadVictoryDom(stubResponse) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'victory.html'), 'utf8');

    dom = new JSDOM(html, {
      url: 'http://localhost/victory.html?gameCode=GAME01',
      runScripts: 'dangerously',
      resources: 'usable',
      beforeParse(window) {
        // Stub fetch before inline script runs
        window.fetch = () =>
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve(stubResponse)
          });

        // Provide fake localStorage
        const store = {};
        window.localStorage = {
          getItem: (k) => (k in store ? store[k] : null),
          setItem: (k, v) => { store[k] = String(v); },
          removeItem: (k) => { delete store[k]; }
        };
        window.localStorage.setItem('session_GAME01', 'sess-123');
      }
    });

    window = dom.window;
    document = window.document;
  }

  afterEach(() => {
    if (window) window.close();
  });

  test('renders winner, kill history, and rankings with highlights', async () => {
    const payload = {
      winner_name: 'Alice',
      current_player_name: 'Bob',
      kill_history: [
        { timestamp: '2024-01-01T10:00:00Z', killer_name: 'Bob', victim_name: 'Charlie', task: 'Make them laugh', killer_session_token: 'sess-123' },
        { timestamp: '2024-01-01T11:00:00Z', killer_name: 'Alice', victim_name: 'Bob', task: 'Say banana', killer_session_token: 'sess-alice' }
      ],
      kill_count: [
        { name: 'Alice', count: 1 },
        { name: 'Bob', count: 1 },
        { name: 'Charlie', count: 0 }
      ]
    };

    loadVictoryDom(payload);
    await new Promise(r => setTimeout(r, 50)); // allow DOM update

    const winnerText = document.getElementById('winnerName').textContent;
    assert.ok(winnerText.includes('Alice'));

    const historyRows = Array.from(document.querySelectorAll('#historyTable tr'));
    assert.strictEqual(historyRows.length, 2);
    assert.ok(historyRows[0].classList.contains('highlight'));

    const countRows = Array.from(document.querySelectorAll('#killCountTable tr'));
    const bobRow = countRows.find(tr => tr.textContent.includes('Bob'));
    assert.ok(bobRow.classList.contains('highlight'));
  });

  test('renders kill count in the order provided by the server', async () => {
    const payload = {
      winner_name: '—',
      current_player_name: null,
      kill_history: [],
      kill_count: [
        { name: 'Zoe', count: 2 },
        { name: 'Alice', count: 3 },
        { name: 'Bob', count: 3 },
        { name: 'Charlie', count: 0 }
      ]
    };

    loadVictoryDom(payload);
    await new Promise(r => setTimeout(r, 50));

    const namesInOrder = Array.from(document.querySelectorAll('#killCountTable tr td:first-child'))
      .map(td => td.textContent);

    // ✅ Expect exact order as provided by server
    assert.deepStrictEqual(namesInOrder, ['Zoe', 'Alice', 'Bob', 'Charlie']);
  });
});