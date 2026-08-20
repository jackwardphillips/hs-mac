import assert from "node:assert/strict";
import test from "node:test";
import {
  classify,
  latestExpectedRun,
  scheduledRunSlots,
  summarize,
  threeDaySuccess,
} from "./health.mjs";

function record(overrides = {}) {
  return {
    finishedAt: "2026-07-24T18:05:00Z",
    status: "success",
    ingestion: { failed: 0 },
    targets: { failed: 0 },
    ebirdHttp: { attempts: 59, failures: 0 },
    summarization: { updated: 7, failed: 0 },
    ...overrides,
  };
}

test("uses the real schedule and permits the intentional 2 AM to 6 AM gap", () => {
  const expected = latestExpectedRun(new Date("2026-07-24T09:30:00Z"));
  assert.equal(expected.toISOString(), "2026-07-24T06:00:00.000Z");
});

test("waits for the 30-minute completion grace period", () => {
  const expected = latestExpectedRun(new Date("2026-07-24T18:20:00Z"));
  assert.equal(expected.toISOString(), "2026-07-24T16:00:00.000Z");
});

test("reports a successful current run as healthy", () => {
  const result = classify([record()], new Date("2026-07-24T18:20:00Z"));
  assert.equal(result.status, "Healthy");
  assert.equal(result.healthy, true);
});

test("reports component failures as degraded", () => {
  const result = classify(
    [record({ ebirdHttp: { attempts: 59, failures: 2 } })],
    new Date("2026-07-24T18:20:00Z"),
  );
  assert.equal(result.status, "Degraded");
  assert.equal(result.healthy, false);
});

test("reports an unsuccessful latest run as failed", () => {
  const result = classify(
    [record({ status: "failure" })],
    new Date("2026-07-24T18:20:00Z"),
  );
  assert.equal(result.status, "Failed");
});

test("reports a missed scheduled run as stale", () => {
  const result = classify(
    [record({ finishedAt: "2026-07-24T16:05:00Z" })],
    new Date("2026-07-24T18:31:00Z"),
  );
  assert.equal(result.status, "Stale");
});

test("reports empty history as unknown", () => {
  const result = classify([], new Date("2026-07-24T18:20:00Z"));
  assert.equal(result.status, "Unknown");
});

test("counts scheduled runs in a rolling three-day window", () => {
  const now = new Date("2026-07-24T18:40:00Z");
  const slots = scheduledRunSlots(now);
  assert.equal(slots.length, 33);

  const records = slots.map((slot) =>
    record({
      startedAt: slot.toISOString(),
      finishedAt: new Date(slot.getTime() + 5 * 60_000).toISOString(),
    }),
  );
  assert.deepEqual(threeDaySuccess(records, now), {
    successful: 33,
    expected: 33,
    percentage: 100,
  });
});

test("counts missed and degraded scheduled runs as unsuccessful", () => {
  const now = new Date("2026-07-24T18:40:00Z");
  const slots = scheduledRunSlots(now);
  const records = slots.slice(1).map((slot, index) =>
    record({
      startedAt: slot.toISOString(),
      finishedAt: new Date(slot.getTime() + 5 * 60_000).toISOString(),
      ...(index === 0 ? { targets: { failed: 1 } } : {}),
    }),
  );
  assert.deepEqual(threeDaySuccess(records, now), {
    successful: 31,
    expected: 33,
    percentage: 94,
  });
});

test("summarizes the rolling three-day success rate", () => {
  const now = new Date("2026-07-24T18:40:00Z");
  const records = scheduledRunSlots(now).map((slot) =>
    record({
      startedAt: slot.toISOString(),
      finishedAt: new Date(slot.getTime() + 5 * 60_000).toISOString(),
    }),
  );
  const result = classify(records, now);
  assert.deepEqual(summarize(result, now), {
    status: "Healthy",
    reason: "The latest scheduled run completed successfully",
    lastRun: "35m ago",
    threeDaySuccess: "100% (33 / 33)",
    ebirdCalls: "59 / 59",
    summaries: "7 updated",
    lastRunAt: "2026-07-24T18:05:00.000Z",
    alertPollRunId: null,
  });
});
