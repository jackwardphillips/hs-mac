import crypto from 'node:crypto';
import { softMatch } from './match.js';

const COLORS = ['#ef476f', '#06d6a0', '#ffd166', '#7bdff2'];

export class Game {
  constructor(code, game) {
    this.code = code;
    this.game = structuredClone(game);
    this.phase = 'lobby';
    this.round = 0;
    this.players = [];
    this.current = null;
    this.buzzed = [];
    this.controller = null;
    this.picker = null;
    this.lockouts = {};
    this.attempt = null;
    this.ruling = null;
    this.final = { wagers: {}, responses: {}, reveal: 0 };
  }

  addPlayer(name, token = crypto.randomUUID()) {
    const cleanName = String(name || `Player ${this.players.length + 1}`).trim().slice(0, 20);
    if (!cleanName) throw new Error('Enter a name');
    const existing = this.players.find((player) => player.token === token);
    if (existing) return existing;
    if (this.phase !== 'lobby') throw new Error('The game has already started');
    if (this.players.length >= 4) throw new Error('This game is full');
    if (this.players.some((player) => player.name.toLowerCase() === cleanName.toLowerCase())) throw new Error('That name is taken');
    const player = { id: crypto.randomUUID(), token, name: cleanName, score: 0, color: COLORS[this.players.length], connected: true };
    this.players.push(player);
    return player;
  }

  start() {
    if (this.phase !== 'lobby') throw new Error('Game already started');
    if (this.players.length < 2) throw new Error('At least 2 players are required');
    this.phase = 'board';
    this.picker = this.players[crypto.randomInt(this.players.length)].id;
  }

  sign(playerId, strokes) {
    if (this.phase !== 'lobby') throw new Error('Signatures are locked');
    const player = this.players.find(p => p.id === playerId);
    if (!player || !Array.isArray(strokes) || !strokes.length || strokes.length > 100) throw new Error('Draw your name first');
    let count = 0;
    for (const stroke of strokes) {
      if (!Array.isArray(stroke) || stroke.length < 2) throw new Error('Invalid signature');
      for (const point of stroke) {
        if (++count > 1000 || !Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Invalid signature');
      }
    }
    player.signature = structuredClone(strokes);
  }

  select(categoryIndex, clueIndex) {
    if (this.phase !== 'board') throw new Error('A clue cannot be selected now');
    const clue = this.game.rounds[this.round]?.[categoryIndex]?.clues?.[clueIndex];
    if (!clue || clue.used) throw new Error('That clue is unavailable');
    clue.used = true;
    this.current = { ...clue, categoryIndex, clueIndex };
    this.buzzed = [];
    this.controller = null;
    this.attempt = null;
    this.lockouts = {};
    this.ruling = null;
    this.opensAt = Date.now() + Math.max(1500, String(clue.prompt).trim().split(/\s+/).length / 4 * 1000 + 500);
    this.phase = clue.dailyDouble ? 'daily-double' : 'clue';
  }

  openBuzzers() {
    if (this.phase !== 'clue') throw new Error('Buzzers cannot open now');
    this.phase = 'buzzing';
    this.buzzEndsAt = Date.now() + 8000;
  }

  setDailyDouble(playerId, wager) {
    if (this.phase !== 'daily-double') throw new Error('This is not a Daily Double');
    const player = this.players.find((item) => item.id === playerId);
    const amount = Number(wager);
    const max = Math.max(this.round === 0 ? 1000 : 2000, player?.score ?? 0);
    if (!player || !Number.isInteger(amount) || amount < 5 || amount > max) throw new Error(`Wager must be between 5 and ${max}`);
    this.current.value = amount;
    this.controller = playerId;
    this.phase = 'daily-clue';
  }

  buzz(playerId, now = Date.now()) {
    if (this.phase === 'clue') { this.lockouts[playerId] = now + 250; return false; }
    if ((this.lockouts[playerId] || 0) > now) return false;
    if (this.phase !== 'buzzing' || this.controller) return false;
    if (this.buzzed.includes(playerId)) return false;
    const player = this.players.find((item) => item.id === playerId);
    if (!player) return false;
    this.buzzed.push(playerId);
    this.ruling = null;
    this.controller = playerId;
    this.phase = 'judging';
    return true;
  }

  submitAnswer(playerId, response) {
    if (!['judging', 'daily-clue'].includes(this.phase) || this.controller !== playerId || this.attempt) throw new Error('You cannot answer now');
    const text = String(response || '').trim().slice(0, 200);
    if (!text) throw new Error('Type an answer first');
    this.attempt = { response: text, suggested: softMatch(text, this.current.response) };
    this.ruling = { playerId, response: text, correct: this.attempt.suggested, expected: this.current.response, value: this.current.value, clue: {...this.current}, round: this.round, picker: this.picker };
    this.players.find(p => p.id === playerId).score += this.ruling.correct ? this.ruling.value : -this.ruling.value;
    this.phase = 'result';
    this.resultEndsAt = Date.now() + 5000;
  }

  override(correct) {
    if (!this.ruling || !['result', 'board', 'buzzing', 'answer', 'round-break', 'final-wager'].includes(this.phase)) throw new Error('That ruling can no longer be changed');
    const r = this.ruling;
    this.players.find(p => p.id === r.playerId).score += (Number(correct) - Number(r.correct)) * 2 * r.value;
    r.correct = correct;
    this.current = {...r.clue}; this.round = r.round; this.picker = r.picker;
    this.controller = r.playerId;
    this.phase = 'result'; this.resultEndsAt = Date.now() + 5000;
  }

  advanceResult() {
    if (this.phase !== 'result') return;
    const r = this.ruling;
    if (r.correct) this.picker = r.playerId;
    this.controller = null; this.attempt = null;
    if (r.correct || this.current.dailyDouble) this.finishClue();
    else if (this.buzzed.length < this.players.length) { this.phase = 'buzzing'; this.buzzEndsAt = Date.now() + 8000; }
    else this.revealAnswer();
  }

  tick(now = Date.now()) {
    if (this.phase === 'clue' && now >= this.opensAt) { this.openBuzzers(); return true; }
    if (this.phase === 'buzzing' && now >= this.buzzEndsAt) { this.showAnswer(); return true; }
    if (this.phase === 'result' && now >= this.resultEndsAt) { this.advanceResult(); return true; }
    if (this.phase === 'answer' && now >= this.answerEndsAt) { this.finishClue(); return true; }
    return false;
  }

  judge(correct) {
    if (!['judging', 'daily-clue'].includes(this.phase) || !this.controller) throw new Error('Nobody is awaiting judgment');
    const player = this.players.find((item) => item.id === this.controller);
    player.score += correct ? this.current.value : -this.current.value;
    if (correct) this.picker = player.id;
    this.attempt = null;
    this.controller = null;
    if (correct || this.current.dailyDouble) this.finishClue();
    else if (this.buzzed.length < this.players.length) { this.phase = 'buzzing'; this.buzzEndsAt = Date.now() + 8000; }
    else this.revealAnswer();
  }

  finishClue() {
    this.phase = this.roundComplete() ? (this.round === 0 ? 'round-break' : 'final-wager') : 'board';
    this.current = null;
    if (this.phase === 'round-break') this.round = 1;
  }

  showAnswer() {
    if (!['clue', 'buzzing', 'answer'].includes(this.phase)) throw new Error('No answer to show');
    this.revealAnswer();
  }

  revealAnswer() {
    this.phase = 'answer';
    this.answerEndsAt = Date.now() + 3000;
  }

  continueAfterAnswer() { if (this.phase !== 'answer') throw new Error('No answer is showing'); this.finishClue(); }
  continueRound() { if (this.phase !== 'round-break') throw new Error('Not between rounds'); this.ruling = null; this.phase = 'board'; }

  submitWager(playerId, amount) {
    if (this.phase !== 'final-wager') throw new Error('Wagers are closed');
    const player = this.players.find((item) => item.id === playerId);
    const wager = Number(amount);
    const max = Math.max(0, player?.score ?? 0);
    if (!player || !Number.isInteger(wager) || wager < 0 || wager > max) throw new Error(`Wager must be between 0 and ${max}`);
    this.final.wagers[playerId] = wager;
    this.ruling = null;
    if (this.players.every((item) => this.final.wagers[item.id] !== undefined)) this.phase = 'final-clue';
  }

  submitFinal(playerId, response) {
    if (this.phase !== 'final-clue') throw new Error('Responses are closed');
    if (!this.players.some((item) => item.id === playerId)) throw new Error('Unknown player');
    if (this.final.responses[playerId] !== undefined) throw new Error('Response already locked');
    this.final.responses[playerId] = String(response).trim().slice(0, 200);
    if (this.players.every((item) => this.final.responses[item.id] !== undefined)) {
      this.final.correct = {};
      for (const player of this.players) {
        const correct = softMatch(this.final.responses[player.id], this.game.final.response);
        this.final.correct[player.id] = correct;
        player.score += correct ? this.final.wagers[player.id] : -this.final.wagers[player.id];
      }
      this.phase = 'finished';
    }
  }

  overrideFinal(playerId, correct) {
    if (this.phase !== 'finished' || this.final.correct?.[playerId] === undefined) throw new Error('No final ruling to override');
    this.players.find(p => p.id === playerId).score += (Number(correct) - Number(this.final.correct[playerId])) * 2 * this.final.wagers[playerId];
    this.final.correct[playerId] = correct;
  }

  judgeFinal(playerId, correct) {
    if (this.phase !== 'final-reveal') throw new Error('Not revealing Final Jeopardy');
    const expected = this.players[this.final.reveal];
    if (!expected || expected.id !== playerId) throw new Error('Reveal players in order');
    expected.score += correct ? this.final.wagers[playerId] : -this.final.wagers[playerId];
    this.final.reveal += 1;
    if (this.final.reveal >= this.players.length) this.phase = 'finished';
  }

  roundComplete() { return this.game.rounds[this.round].every((category) => category.clues.every((clue) => clue.used)); }

  publicState(forPlayer = null, host = false) {
    const revealAnswer = ['answer', 'final-reveal', 'finished'].includes(this.phase);
    return {
      code: this.code, phase: this.phase, round: this.round, players: this.players.map(({ token, ...player }) => player),
      picker: this.picker, opensAt: this.opensAt, serverNow: Date.now(), attempt: host || forPlayer === this.controller ? this.attempt : null,
      buzzEndsAt: this.buzzEndsAt, resultEndsAt: this.resultEndsAt, answerEndsAt: this.answerEndsAt,
      ruling: this.ruling && {playerId:this.ruling.playerId, response:this.ruling.response, correct:this.ruling.correct, expected:host ? this.ruling.expected : undefined},
      board: this.game.rounds[this.round].map(category => ({ name: category.name, clues: category.clues.map(clue => ({value:clue.value, used:clue.used})) })), current: this.current && { ...this.current, prompt: this.phase === 'daily-double' ? undefined : this.current.prompt, response: revealAnswer || host ? this.current.response : undefined },
      controller: this.controller, buzzed: this.buzzed, finalClue: ['final-clue', 'final-reveal', 'finished'].includes(this.phase) ? { ...this.game.final, response: revealAnswer ? this.game.final.response : undefined } : null,
      final: { correct: revealAnswer ? this.final.correct : undefined, wagersSubmitted: Object.keys(this.final.wagers), responsesSubmitted: Object.keys(this.final.responses), wagers: revealAnswer ? this.final.wagers : {}, responses: revealAnswer ? this.final.responses : {}, reveal: this.final.reveal },
      you: forPlayer,
    };
  }
}
