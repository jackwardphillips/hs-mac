import assert from "node:assert/strict";
import test from "node:test";
import { summarizeObservatoryStatus } from "./observatory.mjs";

const now = new Date("2026-08-12T02:00:00Z");

function status(overrides = {}) {
  return {
    checkedAt: "2026-08-12T01:59:00Z",
    api: { status: "healthy" },
    collector: {
      status: "healthy",
      lastSuccessAt: "2026-08-12T01:55:00Z",
      lastRun: { fetchedCount: 305, insertedCount: 2, updatedCount: 303 },
    },
    ...overrides,
  };
}

test("summarizes a healthy Observatory", () => {
  assert.deepEqual(summarizeObservatoryStatus(status(), now), {
    status: "Healthy",
    lastCollection: "5m ago",
    fetched: 305,
    changes: "2 new / 303 updated",
    checkedAt: "2026-08-12T01:59:00Z",
  });
});
test("prioritizes an unhealthy API", () => {
  const result = summarizeObservatoryStatus(
    status({ api: { status: "failed" } }),
    now,
  );
  assert.equal(result.status, "API unhealthy");
});

test("reports failed and overdue collection states", () => {
  const failed = status();
  failed.collector.status = "failed";
  assert.equal(summarizeObservatoryStatus(failed, now).status, "Collection failed");

  const overdue = status();
  overdue.collector.status = "overdue";
  assert.equal(summarizeObservatoryStatus(overdue, now).status, "Collection overdue");
});
