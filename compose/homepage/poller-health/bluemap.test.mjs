import assert from "node:assert/strict";
import test from "node:test";
import { summarizeBlueMapStatus } from "./bluemap.mjs";

test("summarizes a recent successful render", () => {
  assert.deepEqual(
    summarizeBlueMapStatus({
      status: "Healthy",
      mode: "incremental",
      completedAt: "2026-07-31T12:00:00Z",
      duration: "18m",
    }, new Date("2026-07-31T13:00:00Z")),
    {
      status: "Healthy",
      lastRender: "1h ago",
      duration: "18m",
      mode: "Incremental",
      lastRun: "1h ago",
      lastDuration: "18m",
    },
  );
});

test("reports an active render", () => {
  assert.deepEqual(
    summarizeBlueMapStatus({
      status: "Rendering",
      mode: "forced",
      completedAt: "",
      duration: "0m",
    }),
    {
      status: "Rendering",
      lastRender: "In progress",
      duration: "0m",
      mode: "Forced",
      lastRun: "Never",
      lastDuration: "Unknown",
    },
  );
});

test("marks successful status stale after 36 hours", () => {
  assert.equal(
    summarizeBlueMapStatus({
      status: "Healthy",
      completedAt: "2026-07-29T00:00:00Z",
    }, new Date("2026-07-31T00:00:01Z")).status,
    "Stale",
  );
});

test("reports a recent intentional no-activity skip as healthy", () => {
  assert.deepEqual(
    summarizeBlueMapStatus({
      status: "Skipped",
      mode: "skipped",
      completedAt: "2026-07-31T04:10:00Z",
      duration: "0m",
      lastActualCompletedAt: "2026-07-30T03:00:00Z",
      lastActualDuration: "22m",
    }, new Date("2026-07-31T05:10:00Z")),
    {
      status: "Skipped",
      lastRender: "1h ago",
      duration: "0m",
      mode: "Skipped",
      lastRun: "1d ago",
      lastDuration: "22m",
    },
  );
});

test("marks an old intentional skip stale after 36 hours", () => {
  assert.equal(
    summarizeBlueMapStatus({
      status: "Skipped",
      completedAt: "2026-07-29T00:00:00Z",
    }, new Date("2026-07-31T00:00:01Z")).status,
    "Stale",
  );
});
