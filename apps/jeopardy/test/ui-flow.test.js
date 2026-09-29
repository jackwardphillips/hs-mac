import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

test('clue flow uses automatic transitions and simplified host controls', () => {
  assert.match(app, /<button class="primary">Submit<\/button>/);
  assert.doesNotMatch(app, /Lock answer|Back to board|Correct response:|Expected:|Continuing in/);
  assert.match(app, /id="override">Override<\/button>/);
  assert.match(app, /<p class="clue-text answer">/);
});

test('desktop host board is constrained to the TV viewport', () => {
  assert.match(css, /#app\.host-view \{ height:100svh;[^}]*overflow:hidden/);
  assert.match(css, /\.host-view \.board \{ min-height:0;/);
});

test('host clue typography measures and fits within its card', () => {
  assert.match(app, /function fitHostClue\(\)/);
  assert.match(app, /screen\.scrollHeight <= screen\.clientHeight/);
  assert.match(css, /\.host-view \.clue-screen \{ min-height:0; overflow:hidden;/);
  assert.match(css, /font-size:var\(--clue-size/);
});
