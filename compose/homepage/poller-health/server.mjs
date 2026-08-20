import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { classify, summarize } from "./health.mjs";
import { readSystemUpdate } from "./system-update.mjs";
import { readBlueMapStatus } from "./bluemap.mjs";
import { readObservatoryStatus } from "./observatory.mjs";
import { readMinecraftStats } from "./minecraft-stats.mjs";

const historyFile = process.env.POLLER_HISTORY_FILE ?? "/data/poller-history.jsonl";
const systemUpdateFile =
  process.env.SYSTEM_UPDATE_FILE ?? "/data/system-update/status.json";
const blueMapStatusFile =
  process.env.BLUEMAP_STATUS_FILE ?? "/data/bluemap/status.json";
const observatoryStatusFile =
  process.env.OBSERVATORY_STATUS_FILE ?? "/data/observatory/health.json";
const minecraftStatsDirectory =
  process.env.MINECRAFT_STATS_DIRECTORY ?? "/data/minecraft/stats";
const minecraftUserCacheFile =
  process.env.MINECRAFT_USER_CACHE_FILE ?? "/data/minecraft/usercache.json";
const minecraftLogsDirectory =
  process.env.MINECRAFT_LOGS_DIRECTORY ?? "/data/minecraft/logs";
const minecraftScheduleStatusFile =
  process.env.MINECRAFT_SCHEDULE_STATUS_FILE ?? "/data/minecraft/schedule-status.json";
const port = Number(process.env.PORT ?? 3001);

async function readHistory() {
  try {
    const contents = await readFile(historyFile, "utf8");
    return contents
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line)];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

const contentTypes = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png",
};
async function sendStatic(response, requestPath) {
  const file = requestPath === "/minecraft" || requestPath === "/minecraft/"
    ? "index.html" : requestPath.slice("/minecraft/".length);
  const isSkin = /^skins\/[0-9a-f-]{36}\.png$/.test(file);
  if (!isSkin && !new Set(["index.html", "styles.css", "app.js", "dirt.png", "stone.png"]).has(file)) return false;
  const body = await readFile(join("/app/public/minecraft", file));
  response.writeHead(200, { "Content-Type": `${contentTypes[extname(file)]}; charset=utf-8` });
  response.end(body);
  return true;
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET") {
    sendJson(response, 405, { error: "Method not allowed" });
    return;
  }

  if (request.url === "/minecraft" || request.url?.startsWith("/minecraft/")) {
    try {
      if (await sendStatic(response, request.url)) return;
    } catch (error) { console.error(error); }
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  if (
    request.url !== "/health" &&
    request.url !== "/summary" &&
    request.url !== "/system-update" &&
    request.url !== "/bluemap" &&
    request.url !== "/minecraft-schedule" &&
    request.url !== "/observatory" &&
    request.url !== "/minecraft-stats"
  ) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  try {
    const now = new Date();
    if (request.url === "/system-update") {
      sendJson(response, 200, await readSystemUpdate(systemUpdateFile, now));
      return;
    }
    if (request.url === "/bluemap") {
      sendJson(response, 200, await readBlueMapStatus(blueMapStatusFile, now));
      return;
    }
    if (request.url === "/minecraft-schedule") {
      try {
        sendJson(response, 200, JSON.parse(await readFile(minecraftScheduleStatusFile, "utf8")));
      } catch {
        sendJson(response, 503, { status: "unknown", detail: "No readable schedule status" });
      }
      return;
    }
    if (request.url === "/observatory") {
      sendJson(response, 200, await readObservatoryStatus(observatoryStatusFile, now));
      return;
    }
    if (request.url === "/minecraft-stats") {
      sendJson(response, 200, await readMinecraftStats(
        minecraftStatsDirectory, minecraftUserCacheFile, minecraftLogsDirectory,
      ));
      return;
    }

    const result = classify(await readHistory(), now);
    if (request.url === "/health") {
      sendJson(response, result.healthy ? 200 : 503, {
        status: result.status,
        reason: result.reason,
      });
      return;
    }
    sendJson(response, 200, summarize(result, now));
  } catch (error) {
    sendJson(response, 500, {
      status: "Error",
      reason: "Could not read poller health",
    });
    console.error(error);
  }
});

server.listen(port, () => {
  console.log(`Poller health listening on port ${port}`);
});
