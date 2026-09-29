import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const role of ['host', 'player']) {
  test(`expired ${role} session returns to welcome instead of staying on Connecting`, () => {
    const session = new Map([['role', role], ['code', '1234'], ['host-token', 'old-host']]);
    const local = new Map([['jeopardy-token-1234', 'old-player'], ['jeopardy-name-1234', 'Jack']]);
    const storage = map => ({ getItem: key => map.get(key), removeItem: key => map.delete(key) });
    const listeners = {};
    const sent = [];
    const context = vm.createContext({
      document: { querySelector: () => ({}) },
      sessionStorage: storage(session), localStorage: storage(local),
      location: { protocol: 'http:', host: 'localhost' },
      WebSocket: class { addEventListener(type, fn) { listeners[type] = fn; } send(raw) { sent.push(JSON.parse(raw)); } },
    });
    vm.runInContext(fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);
    vm.runInContext('var welcomed = false; renderWelcome = () => { welcomed = true; }; error = () => {};', context);
    listeners.open();
    assert.equal(sent[0].type, role === 'host' ? 'reclaim-host' : 'join');
    listeners.message({ data: JSON.stringify({ type: 'error', message: 'Game not found' }) });
    assert.equal(context.welcomed, true);
    assert.equal(session.has('code'), false);
    assert.equal(session.has('role'), false);
  });
}
