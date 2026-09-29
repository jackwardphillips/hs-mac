import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { loadGames } from './dataset.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(dirname, '..', 'public');
const port = Number(process.env.PORT || 8080);
const clueFile = process.env.CLUE_FILE || path.join(dirname, '..', 'data', 'clues.tsv');
let catalog = [];
try { catalog = loadGames(clueFile); } catch (error) { console.error(`Dataset unavailable: ${error.message}`); }
const games = new Map();
const sockets = new Map();

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(catalog.length ? 200 : 503, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: catalog.length > 0, playableGames: catalog.length }));
  }
  const pathname = request.url === '/' ? '/index.html' : new URL(request.url, 'http://localhost').pathname;
  const filename = path.join(publicDir, path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!filename.startsWith(publicDir)) return send(response, 403, 'Forbidden');
  fs.readFile(filename, (error, content) => {
    if (error) return send(response, 404, 'Not found');
    const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.mp3': 'audio/mpeg' };
    response.writeHead(200, { 'content-type': `${types[path.extname(filename)] || 'application/octet-stream'}; charset=utf-8`, 'cache-control': 'no-cache' });
    response.end(content);
  });
});
function send(response, status, text) { response.writeHead(status, { 'content-type': 'text/plain' }); response.end(text); }

const wss = new WebSocketServer({ server, maxPayload: 16 * 1024 });
wss.on('connection', (socket) => {
  sockets.set(socket, {});
  socket.on('message', (raw) => {
    try { handle(socket, JSON.parse(raw)); } catch (error) { socket.send(JSON.stringify({ type: 'error', message: error.message })); }
  });
  socket.on('close', () => {
    const session = sockets.get(socket);
    sockets.delete(socket);
    if (session?.playerId && games.has(session.code)) {
      const player = games.get(session.code).players.find((item) => item.id === session.playerId);
      if (player) player.connected = false;
      broadcast(session.code);
    }
  });
});

function handle(socket, message) {
  if (message.type === 'list-games') {
    const hostedCodes = new Set([...sockets].filter(([client, session]) => client.readyState === client.OPEN && session.role === 'host').map(([, session]) => session.code));
    const available = [...games.values()]
      .filter((game) => game.phase === 'lobby' && game.players.length < 4 && hostedCodes.has(game.code))
      .map((game) => ({ code: game.code, players: game.players.length }));
    return socket.send(JSON.stringify({ type: 'games', games: available }));
  }
  if (message.type === 'create') {
    if (!catalog.length) throw new Error('No clue dataset is loaded');
    let code; do { code = String(crypto.randomInt(1000, 10000)); } while (games.has(code));
    const game = new Game(code, catalog[crypto.randomInt(catalog.length)]);
    game.hostToken = crypto.randomUUID();
    games.set(code, game);
    sockets.set(socket, { code, role: 'host' });
    socket.send(JSON.stringify({ type: 'identity', role: 'host', code, token: game.hostToken }));
    setTimeout(() => games.delete(code), 12 * 60 * 60 * 1000).unref();
    return broadcast(code);
  }
  if (message.type === 'reclaim-host') {
    const code = String(message.code || '').trim();
    const game = games.get(code);
    if (!game || message.token !== game.hostToken) throw new Error('Host session expired');
    sockets.set(socket, { code, role: 'host' });
    return broadcast(code);
  }
  if (message.type === 'join') {
    const code = String(message.code || '').trim();
    const game = games.get(code);
    if (!game) throw new Error('Game not found');
    const player = game.addPlayer(message.name, message.token);
    player.connected = true;
    sockets.set(socket, { code, role: 'player', playerId: player.id, token: player.token });
    socket.send(JSON.stringify({ type: 'identity', code, token: player.token, playerId: player.id }));
    return broadcast(code);
  }
  const session = sockets.get(socket);
  const game = games.get(session?.code);
  if (!game) throw new Error('Join or create a game first');
  if (game.tick()) broadcast(session.code);
  const hostActions = new Set(['start', 'judge', 'override', 'overrideFinal', 'showAnswer', 'continueAfterAnswer', 'continueRound', 'judgeFinal']);
  if (hostActions.has(message.type) && session.role !== 'host') throw new Error('Only the host can do that');
  const actions = {
    start: () => { if (game.players.some(p => !p.signature)) throw new Error('Wait for everyone to draw their name'); game.start(); },
    signature: () => game.sign(session.playerId, message.strokes),
    select: () => {
      if (session.playerId !== game.picker) throw new Error('It is not your pick');
      game.select(message.category, message.clue);
    },
    setDailyDouble: () => { if (session.playerId !== game.picker) throw new Error('Only the picker can wager'); game.setDailyDouble(session.playerId, message.wager); },
    response: () => game.submitAnswer(session.playerId, message.response),
    override: () => game.override(Boolean(message.correct)),
    overrideFinal: () => game.overrideFinal(message.playerId, Boolean(message.correct)),
    buzz: () => game.buzz(session.playerId), judge: () => game.judge(Boolean(message.correct)), showAnswer: () => game.showAnswer(),
    continueAfterAnswer: () => game.continueAfterAnswer(), continueRound: () => game.continueRound(),
    wager: () => game.submitWager(session.playerId, message.amount), finalResponse: () => game.submitFinal(session.playerId, message.response),
    judgeFinal: () => game.judgeFinal(message.playerId, Boolean(message.correct)),
  };
  if (!actions[message.type]) throw new Error('Unknown action');
  const result = actions[message.type]();
  if (message.type === 'buzz' && !result) return;
  broadcast(session.code);
}

function broadcast(code) {
  const game = games.get(code);
  if (!game) return;
  clearTimeout(game.timer);
  const deadline = {clue:game.opensAt, buzzing:game.buzzEndsAt, result:game.resultEndsAt, answer:game.answerEndsAt}[game.phase];
  if (deadline) game.timer = setTimeout(() => { if (games.get(code) === game) { game.tick(); broadcast(code); } }, Math.max(1, deadline - Date.now())).unref();
  for (const [socket, session] of sockets) {
    if (session.code === code && socket.readyState === socket.OPEN) socket.send(JSON.stringify({ type: 'state', state: game.publicState(session.playerId || null, session.role === 'host') }));
  }
}

server.listen(port, '0.0.0.0', () => console.log(`Jeopardy listening on :${port}; ${catalog.length} playable games loaded`));
