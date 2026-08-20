import { readFile } from "node:fs/promises";
import { relativeTime } from "./system-update.mjs";

const staleAfterHours = 36;

function displayMode(mode) {
  if (mode === "forced") return "Forced";
  if (mode === "incremental") return "Incremental";
  if (mode === "skipped") return "Skipped";
  return "Unknown";
}

export function summarizeBlueMapStatus(result, now = new Date()) {
  const completedAt = Date.parse(result?.completedAt);
  const actualCompletedAt = Date.parse(
    result?.lastActualCompletedAt ??
      (result?.status === "Healthy" && result?.mode !== "skipped"
        ? result?.completedAt
        : undefined),
  );
  let status = result?.status ?? "Unknown";
  if (
    (status === "Healthy" || status === "Skipped") &&
    Number.isFinite(completedAt) &&
    now.getTime() - completedAt > staleAfterHours * 3_600_000
  ) {
    status = "Stale";
  }

  return {
    status,
    lastRender: Number.isFinite(completedAt)
      ? relativeTime(result.completedAt, now)
      : status === "Rendering" ? "In progress" : "Never",
    duration: result?.duration ?? "Unknown",
    mode: displayMode(result?.mode),
    lastRun: Number.isFinite(actualCompletedAt)
      ? relativeTime(new Date(actualCompletedAt).toISOString(), now)
      : "Never",
    lastDuration:
      result?.lastActualDuration ??
      (result?.status === "Healthy" && result?.mode !== "skipped"
        ? result?.duration
        : undefined) ??
      "Unknown",
  };
}

export async function readBlueMapStatus(statusFile, now = new Date()) {
  try {
    return summarizeBlueMapStatus(
      JSON.parse(await readFile(statusFile, "utf8")),
      now,
    );
  } catch {
    return {
      status: "Unknown",
      lastRender: "Never",
      duration: "Unknown",
      mode: "Unknown",
      lastRun: "Never",
      lastDuration: "Unknown",
    };
  }
}
