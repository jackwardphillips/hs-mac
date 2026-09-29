import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('discovery lists only hosted open lobbies and exposes no game secrets', () => {
  const source = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('function handle('), source.indexOf('\nfunction broadcast('));
  const game = (code, phase, count) => ({ code, phase, players: Array(count).fill({ token: 'private' }), hostToken: 'private' });
  const games = new Map([
    ['1000', game('1000', 'lobby', 0)],
    ['1001', game('1001', 'lobby', 3)],
    ['1002', game('1002', 'lobby', 4)],
    ['1003', game('1003', 'board', 2)],
    ['1004', game('1004', 'lobby', 1)],
  ]);
  const sockets = new Map(['1000', '1001', '1002', '1003'].map(code => [{ readyState: 1, OPEN: 1 }, { role: 'host', code }]));
  let result;
  const context = vm.createContext({ games, sockets });
  vm.runInContext(handler, context);
  const client = { send: raw => { result = JSON.parse(raw); } };
  context.handle(client, { type: 'list-games' });
  assert.deepEqual(result, { type: 'games', games: [{ code: '1000', players: 0 }, { code: '1001', players: 3 }] });
  sockets.clear();
  context.handle(client, { type: 'list-games' });
  assert.deepEqual(result, { type: 'games', games: [] });
});
