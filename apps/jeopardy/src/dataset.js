import fs from 'node:fs';

export function parseTsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitTsvLine(lines.shift());
  return lines.map((line) => Object.fromEntries(headers.map((key, i) => [key, splitTsvLine(line)[i] ?? ''])));
}

function splitTsvLine(line) {
  return line.split('\t');
}

export function loadGames(filename) {
  return buildGames(parseTsv(fs.readFileSync(filename, 'utf8')));
}

export function buildGames(rows) {
  const episodes = new Map();
  for (const row of rows) {
    if (!['1', '2', '3'].includes(row.round) || !row.air_date) continue;
    if (!episodes.has(row.air_date)) episodes.set(row.air_date, []);
    episodes.get(row.air_date).push(row);
  }

  const games = [];
  for (const [airDate, clues] of episodes) {
    const rounds = [1, 2].map((round) => buildRound(clues, String(round), round === 1 ? 200 : 400));
    const final = clues.find((clue) => clue.round === '3' && clue.answer && clue.question);
    if (rounds.every(Boolean) && final) {
      games.push({
        airDate,
        rounds,
        final: normalizeClue(final, 0),
      });
    }
  }
  return games;
}

function buildRound(clues, round, baseValue) {
  const categories = new Map();
  for (const clue of clues.filter((item) => item.round === round && item.answer && item.question)) {
    if (!categories.has(clue.category)) categories.set(clue.category, []);
    categories.get(clue.category).push(clue);
  }
  const complete = [...categories.entries()]
    .map(([name, entries]) => [name, entries.sort((a, b) => Number(a.clue_value) - Number(b.clue_value)).slice(0, 5)])
    .filter(([, entries]) => entries.length === 5)
    .slice(0, 6);
  if (complete.length < 6) return null;
  return complete.map(([name, entries]) => ({
    name,
    clues: entries.map((entry, index) => normalizeClue(entry, baseValue * (index + 1))),
  }));
}

function normalizeClue(row, value) {
  return {
    category: row.category,
    prompt: row.answer,
    response: row.question,
    value,
    dailyDouble: Number(row.daily_double_value) > 0,
    used: false,
  };
}
