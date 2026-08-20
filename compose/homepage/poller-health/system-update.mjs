import { readFile } from "node:fs/promises";

export function relativeTime(timestamp, now = new Date()) {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(timestamp)) / 60_000),
  );

  if (!Number.isFinite(elapsedMinutes)) return "Unknown";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export async function readSystemUpdate(
  statusFile,
  now = new Date(),
) {
  try {
    const result = JSON.parse(await readFile(statusFile, "utf8"));
    return {
      status: result.status ?? "Unknown",
      version: result.version ?? "Unknown",
      checked: relativeTime(result.checkedAt, now),
    };
  } catch {
    return {
      status: "Unknown",
      version: "Unknown",
      checked: "Never",
    };
  }
}

