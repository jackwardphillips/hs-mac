#!/opt/homebrew/bin/node

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { classify } from "../../compose/homepage/poller-health/health.mjs";
import {
  assessObservatoryApi,
  assessObservatoryCollectors,
} from "./observatory-health.mjs";
import { reconcileJobStatus } from "./scheduled-job-state.mjs";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeDir = process.env.SCHEDULED_JOB_RUNTIME_DIR ?? path.join(serverRoot, "data/scheduled-job-alerts");
const stateFile = path.join(runtimeDir, "state.json");
const observatoryRuntimeDir = path.join(serverRoot, "data/observatory");
const observatoryHealthFile = path.join(observatoryRuntimeDir, "health.json");
const endpointConfigFile =
  process.env.SCHEDULED_JOB_ENDPOINT_CONFIG ??
  path.join(serverRoot, "config/private-endpoints.json");
let endpointConfig = {};
try {
  endpointConfig = JSON.parse(await readFile(endpointConfigFile, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const observatoryBaseUrl =
  process.env.OBSERVATORY_BASE_URL ?? endpointConfig.observatoryBaseUrl;
const minecraftSupportBaseUrl =
  process.env.MINECRAFT_SUPPORT_BASE_URL ?? endpointConfig.minecraftSupportBaseUrl;
if (!observatoryBaseUrl || !minecraftSupportBaseUrl) {
  throw new Error(`Missing endpoint configuration: ${endpointConfigFile}`);
}
const webhookFile = process.env.SCHEDULED_JOB_WEBHOOK_FILE ?? path.join(serverRoot, "power-monitor/discord-webhook.url");
const now = new Date();

await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
await chmod(runtimeDir, 0o700);
await mkdir(observatoryRuntimeDir, { recursive: true, mode: 0o700 });
await chmod(observatoryRuntimeDir, 0o700);
await chmod(webhookFile, 0o600);
const webhook = (await readFile(webhookFile, "utf8")).trim();
if (!/^https:\/\/(?:canary\.|ptb\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/\S+$/.test(webhook)) {
  throw new Error("Webhook file does not contain a valid Discord webhook URL");
}

let state = {
  jobs: {},
  systemUpdate: { checkedAt: null, consecutiveFailures: 0 },
  observatory: { apiConsecutiveFailures: 0 },
};
try {
  state = { ...state, ...JSON.parse(await readFile(stateFile, "utf8")) };
  state.jobs ??= {};
  state.systemUpdate ??= { checkedAt: null, consecutiveFailures: 0 };
  state.observatory ??= { apiConsecutiveFailures: 0 };
} catch {}

const assessments = [];
const observatorySnapshot = {
  checkedAt: now.toISOString(),
  api: { status: "failed" },
  collector: { status: "unknown", lastSuccessAt: null, lastRun: null },
};

let observatoryApiHealthy = false;
try {
  const healthResponse = await fetch(`${observatoryBaseUrl}/health`, {
    signal: AbortSignal.timeout(5_000),
  });
  const health = await healthResponse.json();
  observatoryApiHealthy =
    healthResponse.ok && health.status === "healthy" && health.database === "available";
} catch {}

const observatoryApi = assessObservatoryApi(
  observatoryApiHealthy,
  Number(state.observatory.apiConsecutiveFailures ?? 0),
);
state.observatory.apiConsecutiveFailures = observatoryApi.consecutiveFailures;
observatorySnapshot.api = {
  status: observatoryApiHealthy ? "healthy" : "failed",
};
assessments.push({
  id: "observatory-api",
  name: "Personal Observatory API",
  status: observatoryApi.status,
  recoveryEligible: observatoryApi.recoveryEligible,
  detail: observatoryApi.detail,
});

if (observatoryApiHealthy) {
  try {
    const statusResponse = await fetch(
      `${observatoryBaseUrl}/collectors/status`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!statusResponse.ok) throw new Error(`HTTP ${statusResponse.status}`);
    const statuses = await statusResponse.json();
    const collector = assessObservatoryCollectors(statuses);
    const usgs = statuses.find((item) => item.collector === "usgs");
    observatorySnapshot.collector = {
      status: collector.status,
      lastSuccessAt: usgs?.last_success ?? null,
      collectors: statuses.map((item) => ({
        name: item.collector,
        status: item.status,
        lastSuccessAt: item.last_success,
        consecutiveFailures: item.consecutive_failures,
      })),
      lastRun: usgs
        ? {
            status: usgs.status,
            completedAt: usgs.last_attempt,
            fetchedCount: usgs.last_fetched_count,
            insertedCount: usgs.last_inserted_count,
            updatedCount: usgs.last_updated_count,
          }
        : null,
    };
    assessments.push({
      id: "observatory-collectors",
      name: "Personal Observatory collectors",
      status: collector.status,
      detail: collector.detail,
    });
  } catch {
    assessments.push({
      id: "observatory-collectors",
      name: "Personal Observatory collectors",
      status: "healthy",
      recoveryEligible: false,
      detail: "Collector history is unavailable while API health is degraded",
    });
  }
} else {
  assessments.push({
    id: "observatory-collectors",
    name: "Personal Observatory collectors",
    status: "healthy",
    recoveryEligible: false,
    detail: "Collector history is unavailable while API health is degraded",
  });
}

try {
  const history = (await readFile(path.join(serverRoot, "apps/twitcher/backend/poller-history.jsonl"), "utf8"))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const result = classify(history, now);
  assessments.push({
    id: "twitcher",
    name: "Twitcher poller",
    status: result.healthy ? "healthy" : result.status === "Failed" || result.status === "Degraded" ? "failed" : "overdue",
    detail: result.healthy ? "Latest scheduled run succeeded" : result.status === "Stale" ? "No completed run after the 30-minute grace period" : result.reason,
  });
} catch {
  assessments.push({ id: "twitcher", name: "Twitcher poller", status: "overdue", detail: "No readable run history" });
}

let blueMap = { status: "Unknown" };
try {
  const response = await fetch(`${minecraftSupportBaseUrl}/bluemap`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  blueMap = await response.json();
} catch {}
assessments.push({
  id: "bluemap",
  name: "BlueMap nightly render",
  status: blueMap.status === "Healthy" || blueMap.status === "Rendering" || blueMap.status === "Skipped" ? "healthy" : blueMap.status === "Failed" ? "failed" : "overdue",
  recoveryEligible: blueMap.status === "Healthy",
  detail: blueMap.status === "Failed" ? "Latest render failed" : blueMap.status === "Stale" ? "No render or intentional skip within 36 hours" : blueMap.status === "Unknown" ? "No readable render status" : blueMap.status === "Skipped" ? "Render skipped because nobody joined" : "Latest render succeeded",
});

try {
  const response = await fetch(`${minecraftSupportBaseUrl}/minecraft-schedule`, {
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const schedule = await response.json();
  const healthy = schedule.status === "healthy";
  assessments.push({
    id: "minecraft-schedule",
    name: "Minecraft scheduler",
    status: healthy ? "healthy" : "failed",
    detail: healthy ? `Surface expects Minecraft ${schedule.expected}` : schedule.detail ?? "Surface scheduler is unhealthy",
  });
} catch {
  assessments.push({ id: "minecraft-schedule", name: "Minecraft scheduler", status: "failed", detail: "Surface scheduler status is unavailable" });
}

try {
  const update = JSON.parse(await readFile(path.join(serverRoot, "data/system-update/status.json"), "utf8"));
  if (update.checkedAt !== state.systemUpdate.checkedAt) {
    const succeeded = update.status === "Up to date" || update.status === "Update available";
    state.systemUpdate = {
      checkedAt: update.checkedAt,
      consecutiveFailures: succeeded ? 0 : Number(state.systemUpdate.consecutiveFailures ?? 0) + 1,
    };
  }
  assessments.push({
    id: "macos-update-check",
    name: "macOS update check",
    status: state.systemUpdate.consecutiveFailures >= 3 ? "failed" : "healthy",
    detail: state.systemUpdate.consecutiveFailures >= 3 ? `${state.systemUpdate.consecutiveFailures} consecutive checks failed` : "Update catalog check succeeded",
  });
} catch {
  assessments.push({ id: "macos-update-check", name: "macOS update check", status: "healthy", detail: "Awaiting a completed status check" });
}

const messages = [];
for (const job of assessments) {
  const previous = state.jobs[job.id]?.status ?? "healthy";
  const status = reconcileJobStatus(previous, job.status, job.recoveryEligible ?? true);
  if (status !== "healthy" && previous === "healthy") {
    const heading = status === "overdue" ? "Job overdue" : "Job failed";
    messages.push(`⚠️ **${heading}** · ${job.name}\n${job.detail}`);
  } else if (status === "healthy" && previous !== "healthy") {
    messages.push(`✅ **Job recovered** · ${job.name}\n${job.detail}`);
  }
  state.jobs[job.id] = { status, changedAt: status === previous ? state.jobs[job.id]?.changedAt ?? now.toISOString() : now.toISOString() };
}

const observatoryTemporaryFile = `${observatoryHealthFile}.tmp.${process.pid}`;
await writeFile(
  observatoryTemporaryFile,
  `${JSON.stringify(observatorySnapshot, null, 2)}\n`,
  { mode: 0o600 },
);
await rename(observatoryTemporaryFile, observatoryHealthFile);

if (messages.length > 0) {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: messages.join("\n\n"), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Discord rejected notification with HTTP ${response.status}`);
}

const temporaryFile = `${stateFile}.tmp.${process.pid}`;
await writeFile(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
await rename(temporaryFile, stateFile);
console.log(`[${now.toISOString()}] checked ${assessments.length} scheduled jobs; notifications=${messages.length}`);
