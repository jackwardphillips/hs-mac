import { readFile } from "node:fs/promises";
import { relativeTime } from "./system-update.mjs";

export function summarizeObservatoryStatus(status, now = new Date()) {
  const apiHealthy = status?.api?.status === "healthy";
  const collectorHealthy = status?.collector?.status === "healthy";
  const lastSuccessAt = status?.collector?.lastSuccessAt ?? null;
  const lastRun = status?.collector?.lastRun ?? null;

  let overall = "Healthy";
  if (!apiHealthy) overall = "API unhealthy";
  else if (!collectorHealthy) {
    overall = status?.collector?.status === "failed" ? "Collection failed" : "Collection overdue";
  }

  return {
    status: overall,
    lastCollection: lastSuccessAt ? relativeTime(lastSuccessAt, now) : "Never",
    fetched: lastRun?.fetchedCount ?? "—",
    changes: lastRun
      ? `${lastRun.insertedCount ?? 0} new / ${lastRun.updatedCount ?? 0} updated`
      : "—",
    checkedAt: status?.checkedAt ?? null,
  };
}
export async function readObservatoryStatus(statusFile, now = new Date()) {
  try {
    const status = JSON.parse(await readFile(statusFile, "utf8"));
    return summarizeObservatoryStatus(status, now);
  } catch {
    return {
      status: "Unknown",
      lastCollection: "Never",
      fetched: "—",
      changes: "—",
      checkedAt: null,
    };
  }
}
