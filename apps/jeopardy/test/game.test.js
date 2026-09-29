import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGames } from '../src/dataset.js';
import { Game } from '../src/game.js';
import { softMatch } from '../src/match.js';

function fixture() {
  const rows = [];
  for (const round of ['1', '2']) for (let category = 0; category < 6; category++) for (let clue = 0; clue < 5; clue++) rows.push({
    round, clue_value: String((clue + 1) * (round === '1' ? 200 : 400)), daily_double_value: category === 0 && clue === 0 && round === '1' ? '1000' : '0',
    category: `Category ${round}-${category}`, answer: `Prompt ${clue}`, question: `Response ${clue}`, air_date: '2026-01-01',
  });
  rows.push({ round:'3', clue_value:'0', daily_double_value:'0', category:'Final', answer:'Final prompt', question:'Final response', air_date:'2026-01-01' });
  return buildGames(rows)[0];
}

test('builds complete boards from an episode', () => {
  const game = fixture();
  assert.equal(game.rounds.length, 2);
  assert.equal(game.rounds[0].length, 6);
  assert.equal(game.rounds[1][5].clues.length, 5);
});

test('enforces lobby size and awards the first buzz', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer('Ada');
  const b = game.addPlayer('Grace');
  game.start();
  game.select(1, 1);
  game.openBuzzers();
  assert.equal(game.buzz(b.id), true);
  assert.equal(game.buzz(a.id), false);
  game.judge(true);
  assert.equal(b.score, 400);
  assert.equal(game.phase, 'board');
});

test('incorrect players are locked out while others can buzz', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer('Ada');
  const b = game.addPlayer('Grace');
  game.start(); game.select(1, 1); game.openBuzzers(); game.buzz(a.id); game.judge(false);
  assert.equal(a.score, -400);
  assert.equal(game.phase, 'buzzing');
  assert.equal(game.buzz(a.id), false);
  assert.equal(game.buzz(b.id), true);
});

test('daily double uses the assigned wager', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer('Ada'); game.addPlayer('Grace');
  game.start(); game.select(0, 0); game.setDailyDouble(a.id, 500); game.judge(false);
  assert.equal(a.score, -500);
  assert.equal(game.phase, 'board');
});

test('random picker belongs to the game and correct answers transfer control', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(), b = game.addPlayer();
  game.start();
  assert.ok([a.id,b.id].includes(game.picker));
  const first = game.picker;
  game.select(1,1); game.openBuzzers(); game.buzz(a.id);
  game.submitAnswer(a.id, 'wrong'); game.advanceResult();
  assert.equal(game.picker, first);
  game.buzz(b.id); game.submitAnswer(b.id, 'Response 1');
  assert.equal(game.attempt.suggested, true);
  game.advanceResult();
  assert.equal(game.picker, b.id);
  assert.equal(b.score, 400);
});

test('reading duration scales with words and early buzz locks out for 250ms', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(); game.addPlayer(); game.start();
  game.game.rounds[0][1].clues[1].prompt = 'one two three four five six seven';
  const before = Date.now(); game.select(1,1);
  assert.ok(game.opensAt >= before + 2250 && game.opensAt <= Date.now() + 2250);
  assert.equal(game.buzz(a.id,1000),false);
  game.openBuzzers();
  assert.equal(game.buzz(a.id,1249),false);
  assert.equal(game.buzz(a.id,1250),true);
});

test('only the buzzer winner can submit once and the host can override either way', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(), b = game.addPlayer(); game.start(); game.select(1,1); game.openBuzzers(); game.buzz(a.id);
  assert.throws(() => game.submitAnswer(b.id,'Response 1'));
  game.submitAnswer(a.id,'Response 1');
  assert.throws(() => game.submitAnswer(a.id,'changed'));
  assert.equal(a.score,400);
  game.override(false); game.advanceResult(); assert.equal(a.score,-400);
  game.buzz(b.id); game.submitAnswer(b.id,'alternative'); game.override(true); game.advanceResult();
  assert.equal(b.score,400);
});

test('public board never leaks upcoming clues or answers; host sees current answer only', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(); game.addPlayer(); game.start(); game.select(1,1);
  const publicState = game.publicState(a.id);
  assert.equal(publicState.board[0].clues[0].response, undefined);
  assert.equal(publicState.board[0].clues[0].prompt, undefined);
  assert.equal(publicState.board[0].clues[0].dailyDouble, undefined);
  assert.equal(publicState.current.response, undefined);
  assert.equal(game.publicState(null,true).current.response,'Response 1');
});

test('signatures are validated, persisted on reconnect and locked after start', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(); game.addPlayer();
  assert.throws(() => game.sign(a.id, [[[Infinity,0],[0,0]]]));
  assert.throws(() => game.sign(a.id, []));
  game.sign(a.id, [[[0,0],[1,1]]]);
  assert.deepEqual(game.addPlayer(null,a.token).signature, [[[0,0],[1,1]]]);
  game.start(); assert.throws(() => game.sign(a.id, [[[0,0],[1,1]]]));
});

test('soft match tolerates formatting and small typos without fuzzy short or numeric answers', () => {
  assert.equal(softMatch('What is the Eiffel Tower?', 'Eiffel Tower'),true);
  assert.equal(softMatch('Shakespear', 'Shakespeare'),true);
  assert.equal(softMatch('cat','car'),false);
  assert.equal(softMatch('1918','1919'),false);
  assert.equal(softMatch('', ''),false);
});

test('no-buzz timeout reveals answer at eight seconds, not before', () => {
  const game = new Game('1234', fixture());
  game.addPlayer(); game.addPlayer(); game.start(); game.select(1,1); game.openBuzzers();
  assert.equal(game.tick(game.buzzEndsAt-1), false);
  assert.equal(game.tick(game.buzzEndsAt), true);
  assert.equal(game.phase,'answer');
  assert.equal(game.publicState().current.response,'Response 1');
  assert.equal(game.tick(game.answerEndsAt-1), false);
  assert.equal(game.tick(game.answerEndsAt), true);
  assert.equal(game.phase, 'board');
});

test('incorrect automatic ruling gets a fresh buzz window, with no timeout while typing', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(); game.addPlayer(); game.start(); game.select(1,1); game.openBuzzers(); game.buzz(a.id);
  assert.equal(game.tick(Date.now()+60000),false);
  game.submitAnswer(a.id,'wrong');
  assert.equal(a.score,-400);
  assert.equal(game.tick(game.resultEndsAt-1),false);
  game.tick(game.resultEndsAt);
  assert.equal(game.phase,'buzzing');
  assert.ok(game.buzzEndsAt > Date.now()+7900);
});

test('all players answering incorrectly reveals the answer without crashing', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(), b = game.addPlayer();
  game.start(); game.select(1,1); game.openBuzzers();
  game.buzz(a.id); game.submitAnswer(a.id,'wrong'); game.advanceResult();
  game.buzz(b.id); game.submitAnswer(b.id,'also wrong');
  assert.doesNotThrow(() => game.advanceResult());
  assert.equal(game.phase, 'answer');
  assert.ok(game.answerEndsAt > Date.now());
});

test('override after automatic return to board restores the clue without double scoring', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(), b = game.addPlayer(); game.start(); game.select(1,1); game.openBuzzers(); game.buzz(a.id);
  game.submitAnswer(a.id,'Response 1'); game.advanceResult();
  assert.equal(game.phase,'board'); assert.equal(a.score,400);
  game.override(false); game.override(false); assert.equal(a.score,-400);
  game.advanceResult(); assert.equal(game.phase,'buzzing');
  game.buzz(b.id); assert.throws(() => game.override(true));
});

test('last-clue override rolls back round transition and restores control', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(); game.addPlayer(); game.start();
  game.game.rounds[0].forEach(c => c.clues.forEach(clue => clue.used = true));
  game.game.rounds[0][1].clues[1].used = false;
  game.select(1,1); game.openBuzzers(); game.buzz(a.id); game.submitAnswer(a.id,'Response 1'); game.advanceResult();
  assert.equal(game.phase,'round-break'); assert.equal(game.round,1);
  game.override(false); game.advanceResult();
  assert.equal(game.phase,'buzzing'); assert.equal(game.round,0);
});

test('Final Jeopardy scores automatically and host overrides are idempotent', () => {
  const game = new Game('1234', fixture());
  const a = game.addPlayer(), b = game.addPlayer();
  a.score = b.score = 1000; game.phase = 'final-wager';
  game.submitWager(a.id,500); game.submitWager(b.id,200);
  game.submitFinal(a.id,'Final response');
  assert.throws(() => game.submitFinal(a.id,'changed'));
  game.submitFinal(b.id,'wrong');
  assert.equal(game.phase,'finished'); assert.equal(a.score,1500); assert.equal(b.score,800);
  game.overrideFinal(a.id,false); game.overrideFinal(a.id,false); assert.equal(a.score,500);
  game.overrideFinal(b.id,true); assert.equal(b.score,1200);
});
