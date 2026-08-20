import assert from "node:assert/strict";
import test from "node:test";
import { attributePlayerKillers, summarizePlayerStats } from "./minecraft-stats.mjs";

test("summarizes player totals and separates unattributed deaths", () => {
  const result = summarizePlayerStats("abc", "Miner", {
    stats: {
      "minecraft:custom": {
        "minecraft:play_time": 72_000,
        "minecraft:deaths": 4,
        "minecraft:mob_kills": 9,
        "minecraft:walk_one_cm": 1_250,
        "minecraft:jump": 12,
        "minecraft:damage_dealt": 155,
        "minecraft:damage_blocked_by_shield": 44,
        "minecraft:damage_absorbed": 26,
        "minecraft:sleep_in_bed": 7,
      },
      "minecraft:killed_by": { "minecraft:silverfish": 2, "aether:slider": 1 },
      "minecraft:mined": { "minecraft:stone": 20, "minecraft:dirt": 3 },
      "minecraft:crafted": { "minecraft:torch": 8 },
    },
  });

  assert.equal(result.playSeconds, 3600);
  assert.equal(result.blocksMined, 23);
  assert.equal(result.distanceMeters, 13);
  assert.equal(result.damageDealt, 16);
  assert.equal(result.damageBlocked, 4);
  assert.equal(result.damageAbsorbed, 3);
  assert.equal(result.timesSlept, 7);
  assert.equal(result.environmentalDeaths, 1);
  assert.deepEqual(result.deathCauses.map(({ label, count }) => [label, count]), [
    ["Silverfish", 2], ["Slider", 1],
  ]);
});

test("replaces generic player deaths with killers named in server logs", () => {
  const players = [
    { name: "Victim", environmentalDeaths: 1, deathCauses: [{ id: "minecraft:player", label: "Player", count: 2 }] },
    { name: "Killer", environmentalDeaths: 0, deathCauses: [] },
  ];
  const result = attributePlayerKillers(players,
    "[12:00:00] [Server thread/INFO]: Victim was slain by Killer\n" +
    "[12:01:00] [Server thread/INFO]: Victim fell from a high place\n");
  assert.deepEqual(result[0].deathCauses, [
    { id: "environment:falling", label: "Falling", count: 1 },
    { id: "player:Killer", label: "Killer", count: 1 },
    { id: "minecraft:player", label: "Player", count: 1 },
  ]);
  assert.equal(result[0].environmentalDeaths, 0);
});
