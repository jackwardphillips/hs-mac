const app = document.querySelector('#app');
const toast = document.querySelector('#toast');
let ws;
let state;
let discoveryTimer;
let signatureDraft = [];
let answerDraft = '';
let restoringSession = false;
let role = sessionStorage.getItem('role');
const hostAudio = typeof Audio === 'function' ? {
  noAnswer: new Audio('/sounds/no_answer.mp3'),
  finalJeopardy: new Audio('/sounds/final_jeopardy_music.mp3'),
} : null;

if (hostAudio) {
  hostAudio.noAnswer.preload = 'auto';
  hostAudio.finalJeopardy.preload = 'auto';
}

connect();
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
  ws.addEventListener('open', () => {
    const code = sessionStorage.getItem('code');
    const token = localStorage.getItem(`jeopardy-token-${code}`);
    const name = localStorage.getItem(`jeopardy-name-${code}`);
    restoringSession = false;
    if (role === 'player' && code && token) { restoringSession = true; send('join', { code, token, name }); }
    else if (role === 'host' && code && sessionStorage.getItem('host-token')) { restoringSession = true; send('reclaim-host', { code, token: sessionStorage.getItem('host-token') }); }
    else renderWelcome();
  });
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === 'games') return renderGames(message.games);
    if (message.type === 'error') {
      if (restoringSession) {
        restoringSession = false;
        role = null;
        state = null;
        sessionStorage.removeItem('role');
        sessionStorage.removeItem('code');
        sessionStorage.removeItem('host-token');
        renderWelcome();
        return error('Your previous game is no longer available. Join or host a new game.');
      }
      return error(message.message);
    }
    if (message.type === 'identity') {
      sessionStorage.setItem('code', message.code);
      if (message.role === 'host') sessionStorage.setItem('host-token', message.token);
      else localStorage.setItem(`jeopardy-token-${message.code}`, message.token);
    }
    if (message.type === 'state') { restoringSession = false; if (state?.controller !== message.state.controller || state?.phase !== message.state.phase) answerDraft = ''; const previousPhase = state?.phase; state = message.state; syncHostAudio(previousPhase, state.phase); sessionStorage.setItem('code', state.code); render(); }
  });
  ws.addEventListener('close', () => {
    clearInterval(discoveryTimer);
    app.querySelectorAll('button').forEach(button => button.disabled = true);
    error('Connection lost. Reconnecting…');
    const list = app.querySelector('#available-games');
    if (list) { delete list.dataset.markup; list.textContent = 'Connection lost. Reconnecting…'; }
    setTimeout(connect, 1200);
  });
}
function send(type, data = {}) { if (ws.readyState !== WebSocket.OPEN) return error('Reconnecting—please wait.'); ws.send(JSON.stringify({ type, ...data })); }
function error(message) { toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 3500); }
function money(value) { return `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString()}`; }
function playSound(sound) { if (!sound) return; sound.currentTime = 0; sound.play().catch(() => {}); }
function stopSound(sound) { if (!sound) return; sound.pause(); sound.currentTime = 0; }
function syncHostAudio(previousPhase, nextPhase) {
  if (!hostAudio || role !== 'host') return;
  if (previousPhase === 'buzzing' && nextPhase === 'answer') playSound(hostAudio.noAnswer);
  if (nextPhase === 'final-clue' && previousPhase !== 'final-clue') playSound(hostAudio.finalJeopardy);
  else if (previousPhase === 'final-clue' && nextPhase !== 'final-clue') stopSound(hostAudio.finalJeopardy);
}
function unlockHostAudio() {
  if (!hostAudio) return;
  for (const sound of Object.values(hostAudio)) {
    sound.muted = true;
    const playback = sound.play();
    playback?.then(() => { sound.pause(); sound.currentTime = 0; sound.muted = false; }, () => { sound.muted = false; });
  }
}

function renderWelcome() {
  app.classList.remove('host-view');
  app.innerHTML = `<section class="card center stack welcome"><h1 class="logo"><img src="/jeopardy-logo.png" alt="Jeopardy!"></h1><button class="primary" id="host">Host</button><div class="divider">Available Games</div><section class="discovery" aria-label="Available games"><div id="available-games" aria-live="polite">Looking for games…</div></section></section>`;
  const refreshGames = () => { if (ws.readyState === WebSocket.OPEN) send('list-games'); };
  clearInterval(discoveryTimer);
  refreshGames();
  discoveryTimer = setInterval(refreshGames, 5000);
  app.querySelector('#host').onclick = () => { unlockHostAudio(); role = 'host'; sessionStorage.setItem('role', role); send('create'); };
}

function renderGames(games) {
  const list = app.querySelector('#available-games');
  if (!list) return;
  const markup = games.map((game) => `<button type="button" class="available-game" data-code="${escapeHtml(game.code)}"><span class="available-game-details"><strong>Open game</strong><small>${game.players} of 4 players</small></span><span class="available-game-action">Join <span aria-hidden="true">→</span></span></button>`).join('') || '<p class="empty-games">No games available. Host one to get started.</p>';
  // Preserve focus while the same list is refreshed in the background.
  if (list.dataset.markup === markup) return;
  list.dataset.markup = markup;
  list.innerHTML = markup;
  list.querySelectorAll('[data-code]').forEach((button) => {
    button.onclick = () => {
      role = 'player';
      signatureDraft = [];
      sessionStorage.setItem('role', role);
      send('join', { code: button.dataset.code });
    };
  });
}

function render() {
  clearInterval(discoveryTimer);
  app.classList.toggle('host-view', role === 'host');
  role === 'host' ? renderHost() : renderPlayer();
  if (role === 'host' && state.ruling) {
    app.insertAdjacentHTML('beforeend', `<aside class="ruling-panel">${playerName(state.players.find(p => p.id === state.ruling.playerId))}<span>“${escapeHtml(state.ruling.response)}” — ${state.ruling.correct ? 'Correct' : 'Incorrect'}</span><button class="secondary" id="override">Override</button></aside>`);
    app.querySelector('#override').onclick = () => send('override', {correct:!state.ruling.correct});
  }
}
function playerName(p) { return p?.signature ? `<svg class="signature" viewBox="0 0 600 200" role="img" aria-label="${escapeHtml(p.name)} handwritten name">${p.signature.map(stroke => `<polyline points="${stroke.map(([x,y]) => `${x*600},${y*200}`).join(' ')}"/>`).join('')}</svg>` : escapeHtml(p?.name || ''); }
function scoreStrip() { return `<div class="scores">${state.players.map((p) => `<div class="score" style="--player:${p.color}">${playerName(p)}<strong>${money(p.score)}</strong></div>`).join('')}</div>`; }
function header() { return `<header class="topbar"><span class="logo logo-small"><img src="/jeopardy-logo.png" alt="Jeopardy!"></span><span class="round-label">${state.phase.startsWith('final') ? 'Final Jeopardy' : state.phase === 'finished' ? 'Game complete' : state.round ? 'Double Jeopardy' : 'Jeopardy round'}</span><span class="code">GAME ${state.code}</span></header>${scoreStrip()}`; }

function renderHost() {
  if (state.phase === 'lobby') {
    app.innerHTML = `<section class="card center"><h1 class="logo"><img src="/jeopardy-logo.png" alt="Jeopardy!"></h1><p>Players: open <strong>${location.origin}</strong> and enter</p><div class="code">${state.code}</div><div class="players">${state.players.map((p) => `<span class="player ${p.connected ? '' : 'offline'}" style="--player:${p.color}">${escapeHtml(p.name)}</span>`).join('') || 'Waiting for players…'}</div><p>2–4 players</p><button class="primary" id="start" ${state.players.length < 2 ? 'disabled' : ''}>Start game</button></section>`;
    app.querySelector('.players').innerHTML = state.players.map(p => `<span class="player" style="--player:${p.color}">${playerName(p)}<small>${p.signature ? 'Ready' : 'Drawing name…'}${p.connected ? '' : ' · Offline'}</small></span>`).join('') || 'Waiting for players…';
    app.querySelector('#start').disabled = state.players.length < 2 || state.players.some(p => !p.signature);
    app.querySelector('#start').onclick = () => send('start'); return;
  }
  if (state.phase === 'board') return renderBoard();
  if (state.phase === 'round-break') return renderInterstitial('DOUBLE JEOPARDY!', 'continueRound', 'Start round');
  if (state.phase === 'final-wager') return renderWaiting('FINAL JEOPARDY!', 'Waiting for everyone to submit a wager on their phone.');
  if (['final-clue', 'final-reveal', 'finished'].includes(state.phase)) return renderFinalHost();
  renderClueHost();
}

function renderBoard() {
  const categories = state.board.map((c) => `<div class="category">${escapeHtml(c.name)}</div>`).join('');
  const clues = Array.from({ length: 5 }, (_, row) => state.board.map((c, col) => `<button class="clue ${c.clues[row].used ? 'used' : ''}" data-c="${col}" data-r="${row}" ${c.clues[row].used ? 'disabled' : ''}>${money(c.clues[row].value)}</button>`).join('')).join('');
  app.innerHTML = `${header()}<div class="pick-banner">${playerName(state.players.find(p => p.id === state.picker))}<span>${role === 'player' && state.you === state.picker ? 'Your pick! Choose a category and amount.' : 'is choosing on their phone…'}</span></div><div class="board">${categories}${clues}</div>`;
  if (role === 'host' || state.you !== state.picker) app.querySelectorAll('.clue').forEach(button => button.disabled = true);
  app.querySelectorAll('.clue:not(.used)').forEach((button) => button.onclick = () => send('select', { category: Number(button.dataset.c), clue: Number(button.dataset.r) }));
}

function renderClueHost() {
  const c = state.current;
  const controller = state.players.find((p) => p.id === state.controller);
  const hiddenDailyDouble = state.phase === 'daily-double';
  app.innerHTML = `${header()}<section class="clue-screen"><div class="category-label">${escapeHtml(c.category)} · ${money(c.value)}</div><p class="clue-text">${hiddenDailyDouble ? 'DAILY DOUBLE!' : escapeHtml(c.prompt)}</p>${state.phase === 'answer' ? `<p class="clue-text answer">${escapeHtml(c.response)}</p>` : ''}<div class="controls" id="controls"></div></section>`;
  const controls = app.querySelector('#controls');
  if (state.phase === 'daily-double') {
    controls.innerHTML = `<strong>Waiting for ${playerName(state.players.find(p => p.id === state.picker))} to wager on their phone.</strong>`;
  } else if (state.phase === 'clue') { controls.innerHTML = '<strong class="signal red">WAIT</strong>'; }
  else if (state.phase === 'buzzing') { controls.innerHTML = `<strong class="signal green">BUZZERS OPEN</strong><button class="secondary" id="answer">Show answer</button>`; }
  else if (state.phase === 'result') { controls.innerHTML = `<strong>${playerName(controller)} · ${state.ruling.correct ? 'Correct!' : 'Incorrect'}</strong><p>“${escapeHtml(state.ruling.response)}”</p>`; }
  else if (['judging', 'daily-clue'].includes(state.phase)) controls.innerHTML = `<strong>${playerName(controller)} is typing…</strong><button class="wrong" id="no">Player cannot answer</button>`;
  else controls.innerHTML = '';
  controls.querySelector('#open')?.addEventListener('click', () => send('openBuzzers'));
  controls.querySelector('#answer')?.addEventListener('click', () => send('showAnswer'));
  controls.querySelector('#yes')?.addEventListener('click', () => send('judge', { correct: true }));
  controls.querySelector('#no')?.addEventListener('click', () => send('judge', { correct: false }));
  requestAnimationFrame(fitHostClue);
}

function fitHostClue() {
  const screen = app.querySelector('.clue-screen');
  if (!screen || role !== 'host' || innerWidth <= 700) return;
  let low = 16;
  let high = Math.min(88, innerWidth * .05);
  while (high - low > .5) {
    const size = (low + high) / 2;
    screen.style.setProperty('--clue-size', `${size}px`);
    if (screen.scrollHeight <= screen.clientHeight) low = size;
    else high = size;
  }
  screen.style.setProperty('--clue-size', `${low}px`);
}

globalThis.addEventListener?.('resize', () => requestAnimationFrame(fitHostClue));

function renderPlayer() {
  const you = state.players.find((p) => p.id === state.you);
  if (state.phase === 'lobby' && !you.signature) return renderSignature();
  if (state.phase === 'board') return renderBoard();
  let content = '<p>Watch the main screen.</p>';
  if (state.phase === 'lobby') content = '<h2>You’re ready!</h2><p>Waiting for the host to start.</p>';
  else if (['clue', 'buzzing'].includes(state.phase)) content = `<p>${escapeHtml(state.current.prompt)}</p><div class="signal ${state.phase === 'clue' ? 'red' : 'green'}">${state.phase === 'clue' ? 'WAIT' : 'BUZZERS OPEN'}</div><button class="buzzer ${state.phase === 'buzzing' ? 'green' : 'red'}" id="buzz" ${state.buzzed.includes(state.you) ? 'disabled' : ''}>${state.phase === 'clue' ? 'WAIT' : 'BUZZ!'}</button>`;
  else if (state.phase === 'daily-double' && state.picker === state.you) content = `<h2>Daily Double!</h2><p>Wager $5–${Math.max(state.round ? 2000 : 1000, you.score)}</p><input id="dd-wager" type="number" min="5" aria-label="Daily Double wager"><button class="primary" id="dd-go">Lock wager</button>`;
  else if (state.phase === 'result') content = `<h2>${state.ruling.correct ? 'Correct!' : 'Incorrect'}</h2>${playerName(state.players.find(p => p.id === state.ruling.playerId))}<p>“${escapeHtml(state.ruling.response)}”</p>`;
  else if (state.controller === state.you) content = `<h2>You’re up!</h2><p>${escapeHtml(state.current.prompt)}</p><form id="answer-form"><input id="typed-answer" maxlength="200" placeholder="Type your answer" aria-label="Your answer" autocomplete="off" required><button class="primary">Submit</button></form>`;
  else if (state.phase === 'final-wager' && !state.final.wagersSubmitted.includes(state.you)) content = `<h2>Final Jeopardy wager</h2><input id="wager" type="number" min="0" max="${Math.max(0,you.score)}"><button class="primary" id="wager-go">Lock wager</button>`;
  else if (state.phase === 'final-clue' && !state.final.responsesSubmitted.includes(state.you)) content = `<h2>${escapeHtml(state.finalClue.category)}</h2><p>${escapeHtml(state.finalClue.prompt)}</p><input id="response" maxlength="200" placeholder="Who or what is…"><button class="primary" id="response-go">Lock response</button>`;
  else if (state.phase === 'finished') content = '<h2>Game over!</h2>';
  app.innerHTML = `<section class="card center stack"><h2 style="color:${you?.color}">${playerName(you)}</h2><div class="score"><strong>${money(you?.score || 0)}</strong></div><div class="status">${content}</div></section>`;
  const answer = app.querySelector('#typed-answer');
  if (answer) { answer.value = answerDraft; answer.oninput = () => { answerDraft = answer.value; }; app.querySelector('#answer-form').onsubmit = e => { e.preventDefault(); send('response', {response:answer.value}); }; answer.focus(); }
  app.querySelector('#dd-go')?.addEventListener('click', () => send('setDailyDouble', {wager:Number(app.querySelector('#dd-wager').value)}));
  app.querySelector('#buzz')?.addEventListener('click', () => { navigator.vibrate?.(40); send('buzz'); });
  app.querySelector('#wager-go')?.addEventListener('click', () => send('wager', { amount: Number(app.querySelector('#wager').value) }));
  app.querySelector('#response-go')?.addEventListener('click', () => send('finalResponse', { response: app.querySelector('#response').value }));
}

function renderSignature() {
  app.innerHTML = `<section class="card center stack"><h2>Draw your name</h2><p>Make it yours. This appears on your podium.</p><canvas id="signature-pad" width="600" height="200" aria-label="Draw your name with your finger or mouse"></canvas><button class="secondary" id="clear-signature">Clear</button><button class="primary" id="save-signature">That’s my name</button></section>`;
  const canvas = app.querySelector('canvas'), ctx = canvas.getContext('2d');
  let stroke = null;
  const paint = () => { ctx.clearRect(0,0,600,200); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; for (const points of signatureDraft) { ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(x*600,y*200) : ctx.moveTo(x*600,y*200)); ctx.stroke(); } };
  const point = e => { const r = canvas.getBoundingClientRect(); return [Math.max(0,Math.min(1,Math.round((e.clientX-r.left)/r.width*1000)/1000)), Math.max(0,Math.min(1,Math.round((e.clientY-r.top)/r.height*1000)/1000))]; };
  canvas.onpointerdown = e => { if (signatureDraft.length >= 100) return; canvas.setPointerCapture(e.pointerId); stroke = [point(e), point(e)]; signatureDraft.push(stroke); paint(); };
  canvas.onpointermove = e => { if (stroke && signatureDraft.reduce((sum,s) => sum+s.length,0) < 900) { stroke.push(point(e)); paint(); } };
  canvas.onpointerup = canvas.onpointercancel = () => { stroke = null; };
  app.querySelector('#clear-signature').onclick = () => { signatureDraft = []; paint(); };
  app.querySelector('#save-signature').onclick = () => send('signature', {strokes:signatureDraft});
  paint();
}

function renderWaiting(title, text) { app.innerHTML = `${header()}<section class="card center"><h1>${title}</h1><p>${text}</p></section>`; }
function renderInterstitial(title, action, label) { renderWaiting(title, `<button class="primary" id="next">${label}</button>`); app.querySelector('#next').onclick = () => send(action); }
function renderFinalHost() {
  if (state.phase === 'final-clue') return renderWaiting('FINAL JEOPARDY!', `<strong>${escapeHtml(state.finalClue.category)}</strong><p class="clue-text">${escapeHtml(state.finalClue.prompt)}</p><p>Waiting for responses…</p>`);
  if (state.phase === 'finished') {
    const winner = [...state.players].sort((a,b) => b.score-a.score)[0];
    renderWaiting('GAME OVER', `<h2>${playerName(winner)} wins with ${money(winner.score)}!</h2>${scoreStrip()}<p class="clue-text answer">${escapeHtml(state.finalClue.response)}</p>${state.players.map(p => `<div class="ruling-panel">${playerName(p)}<span>${escapeHtml(state.final.responses[p.id])} · ${state.final.correct?.[p.id] ? 'Correct' : 'Incorrect'}</span><button class="secondary" data-final-player="${p.id}">Override</button></div>`).join('')}`);
    app.querySelectorAll('[data-final-player]').forEach(button => button.onclick = () => send('overrideFinal', {playerId:button.dataset.finalPlayer, correct:!state.final.correct[button.dataset.finalPlayer]}));
    return;
  }
  const player = state.players[state.final.reveal];
  app.innerHTML = `${header()}<section class="card center"><h2>${escapeHtml(player.name)}</h2><p>Wager: ${money(state.final.wagers[player.id])}</p><p class="answer">${escapeHtml(state.final.responses[player.id] || '(No response)')}</p><p class="clue-text answer">${escapeHtml(state.finalClue.response)}</p><div class="controls"><button class="correct" id="yes">Correct</button><button class="wrong" id="no">Incorrect</button></div></section>`;
  app.querySelector('#yes').onclick = () => send('judgeFinal', { playerId: player.id, correct: true });
  app.querySelector('#no').onclick = () => send('judgeFinal', { playerId: player.id, correct: false });
}
function escapeHtml(value='') { const div=document.createElement('div'); div.textContent=String(value); return div.innerHTML; }
