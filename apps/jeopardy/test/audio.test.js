import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('host audio follows unanswered and Final Jeopardy phase transitions', () => {
  const audio = [];
  class Audio {
    constructor(src) { this.src = src; this.currentTime = 4; this.playCount = 0; this.pauseCount = 0; audio.push(this); }
    play() { this.playCount++; return Promise.resolve(); }
    pause() { this.pauseCount++; }
  }
  const context = vm.createContext({
    Audio,
    document: { querySelector: () => ({}) },
    sessionStorage: { getItem: () => 'host' },
    localStorage: { getItem: () => null },
    location: { protocol: 'http:', host: 'localhost' },
    WebSocket: class { addEventListener() {} },
  });
  vm.runInContext(fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8'), context);

  vm.runInContext("syncHostAudio('buzzing', 'answer')", context);
  assert.equal(audio[0].src, '/sounds/no_answer.mp3');
  assert.equal(audio[0].playCount, 1);
  assert.equal(audio[0].currentTime, 0);

  vm.runInContext("syncHostAudio('final-wager', 'final-clue'); syncHostAudio('final-clue', 'final-clue')", context);
  assert.equal(audio[1].src, '/sounds/final_jeopardy_music.mp3');
  assert.equal(audio[1].playCount, 1);

  vm.runInContext("syncHostAudio('final-clue', 'final-reveal')", context);
  assert.equal(audio[1].pauseCount, 1);
  assert.equal(audio[1].currentTime, 0);
});
