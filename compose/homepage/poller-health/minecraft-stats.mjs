import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";

const CUSTOM = "minecraft:custom";
const DISTANCE_STATS = [
  "minecraft:walk_one_cm", "minecraft:sprint_one_cm", "minecraft:crouch_one_cm",
  "minecraft:swim_one_cm", "minecraft:walk_on_water_one_cm",
  "minecraft:walk_under_water_one_cm", "minecraft:fly_one_cm",
  "minecraft:boat_one_cm", "minecraft:horse_one_cm", "minecraft:climb_one_cm",
];

const friendlyEntity = (id) => id.split(":").at(-1).replaceAll("_", " ")
  .replace(/\b\w/g, (letter) => letter.toUpperCase());

const sumValues = (object = {}) => Object.values(object).reduce((sum, value) => sum + value, 0);

export function summarizePlayerStats(uuid, name, document, modifiedAt = null) {
  const stats = document?.stats ?? {};
  const custom = stats[CUSTOM] ?? {};
  const killedBy = stats["minecraft:killed_by"] ?? {};
  const deaths = custom["minecraft:deaths"] ?? 0;
  const knownCauses = sumValues(killedBy);

  return {
    uuid,
    name,
    playSeconds: Math.floor((custom["minecraft:play_time"] ?? 0) / 20),
    deaths,
    deathCauses: Object.entries(killedBy)
      .map(([id, count]) => ({ id, label: friendlyEntity(id), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    environmentalDeaths: Math.max(0, deaths - knownCauses),
    mobKills: custom["minecraft:mob_kills"] ?? 0,
    playerKills: custom["minecraft:player_kills"] ?? 0,
    blocksMined: sumValues(stats["minecraft:mined"]),
    itemsCrafted: sumValues(stats["minecraft:crafted"]),
    distanceMeters: Math.round(DISTANCE_STATS.reduce(
      (total, key) => total + (custom[key] ?? 0), 0,
    ) / 100),
    jumps: custom["minecraft:jump"] ?? 0,
    looted: custom["lootr:looted_stat"] ?? 0,
    waystones: custom["minecraft:waystone_activated"] ?? 0,
    trades: custom["minecraft:traded_with_villager"] ?? 0,
    animalsBred: custom["minecraft:animals_bred"] ?? 0,
    fishCaught: custom["minecraft:fish_caught"] ?? 0,
    damageDealt: Math.round((custom["minecraft:damage_dealt"] ?? 0) / 10),
    damageTaken: Math.round((custom["minecraft:damage_taken"] ?? 0) / 10),
    damageBlocked: Math.round((custom["minecraft:damage_blocked_by_shield"] ?? 0) / 10),
    damageAbsorbed: Math.round((custom["minecraft:damage_absorbed"] ?? 0) / 10),
    timesSlept: custom["minecraft:sleep_in_bed"] ?? 0,
    updatedAt: modifiedAt,
  };
}

export function attributePlayerKillers(players, logContents) {
  const playerNames = new Set(players.map(({ name }) => name));
  const kills = new Map();
  const environmentalCandidates = new Map();
  for (const line of logContents.split("\n")) {
    const marker = line.indexOf("[Server thread/INFO]: ");
    if (marker < 0) continue;
    const message = line.slice(marker + "[Server thread/INFO]: ".length);
    const victim = [...playerNames].find((name) => message.startsWith(`${name} `));
    if (!victim) continue;
    let category = null;
    if (/tried to swim in lava|burned to death|went up in flames/.test(message)) category = "Lava / fire";
    else if (/fell from a high place|hit the ground too hard|doomed to fall/.test(message)) category = "Falling";
    else if (/drowned/.test(message)) category = "Drowning";
    else if (/suffocated/.test(message)) category = "Suffocation";
    if (category) {
      const victimCandidates = environmentalCandidates.get(victim) ?? new Map();
      victimCandidates.set(category, (victimCandidates.get(category) ?? 0) + 1);
      environmentalCandidates.set(victim, victimCandidates);
    }
    const killer = [...playerNames].find((name) =>
      name !== victim && new RegExp(`\\bby ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\b|$)`).test(message));
    if (!killer) continue;
    const key = `${victim}\0${killer}`;
    kills.set(key, (kills.get(key) ?? 0) + 1);
  }

  return players.map((player) => {
    const genericPlayerDeaths = player.deathCauses.find(({ id }) => id === "minecraft:player")?.count ?? 0;
    const attributed = [...kills.entries()]
      .filter(([key]) => key.startsWith(`${player.name}\0`))
      .map(([key, count]) => ({ id: `player:${key.split("\0")[1]}`, label: key.split("\0")[1], count }));
    const attributedCount = attributed.reduce((sum, cause) => sum + cause.count, 0);
    const replacement = attributed.slice();
    if (attributedCount < genericPlayerDeaths) {
      replacement.push({ id: "minecraft:player", label: "Player", count: genericPlayerDeaths - attributedCount });
    }
    const causes = player.deathCauses
      .filter(({ id }) => id !== "minecraft:player")
      .concat(replacement);
    let remainingEnvironmental = player.environmentalDeaths;
    const environmental = [];
    const candidates = environmentalCandidates.get(player.name) ?? new Map();
    for (const label of ["Lava / fire", "Drowning", "Suffocation", "Falling"]) {
      if (!remainingEnvironmental) break;
      const candidateCount = candidates.get(label) ?? 0;
      if (!candidateCount) continue;
      const count = Math.min(candidateCount, remainingEnvironmental);
      environmental.push({ id: `environment:${label.toLowerCase().replaceAll(" ", "_")}`, label, count });
      remainingEnvironmental -= count;
    }
    if (remainingEnvironmental) {
      environmental.push({ id: "environment:unknown", label: "Environment / unknown", count: remainingEnvironmental });
    }
    return {
      ...player,
      deathCauses: causes
        .concat(environmental)
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      environmentalDeaths: 0,
    };
  });
}

async function readLogs(logsDirectory) {
  if (!logsDirectory) return "";
  try {
    const files = (await readdir(logsDirectory)).filter((file) => file.endsWith(".log") || file.endsWith(".log.gz"));
    const contents = await Promise.all(files.map(async (file) => {
      const data = await readFile(join(logsDirectory, file));
      return file.endsWith(".gz") ? gunzipSync(data).toString("utf8") : data.toString("utf8");
    }));
    return contents.join("\n");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

export async function readMinecraftStats(statsDirectory, userCacheFile, logsDirectory = null) {
  const cache = JSON.parse(await readFile(userCacheFile, "utf8"));
  const names = new Map(cache.map(({ uuid, name }) => [uuid, name]));
  const files = (await readdir(statsDirectory)).filter((file) => file.endsWith(".json"));
  const players = await Promise.all(files.map(async (file) => {
    const uuid = basename(file, ".json");
    const path = join(statsDirectory, file);
    const [contents, metadata] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    return summarizePlayerStats(
      uuid,
      names.get(uuid) ?? uuid,
      JSON.parse(contents),
      metadata.mtime.toISOString(),
    );
  }));

  const attributedPlayers = attributePlayerKillers(players, await readLogs(logsDirectory));
  attributedPlayers.sort((a, b) => b.playSeconds - a.playSeconds || a.name.localeCompare(b.name));
  return { generatedAt: new Date().toISOString(), players: attributedPlayers };
}
