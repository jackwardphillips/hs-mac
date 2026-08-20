import assert from "node:assert/strict";
import test from "node:test";
import {
  assessObservatoryApi,
  assessObservatoryCollector,
  assessObservatoryCollectors,
} from "./observatory-health.mjs";

const now = new Date("2026-08-12T02:00:00Z");

function run(overrides = {}) {
  return {
    status: "succeeded",
    completed_at: "2026-08-12T01:55:00Z",
    fetched_count: 300,
    inserted_count: 2,
    updated_count: 298,
    error: null,
    ...overrides,
  };
}

test("collector is healthy after a recent successful run", () => {
  const result = assessObservatoryCollector([run()], now);
  assert.equal(result.status, "healthy");
  assert.match(result.detail, /fetched 300/);
});
test("collector alerts after three consecutive failures", () => {
  const runs = [
    run({ status: "failed", error: { message: "timeout" } }),
    run({ status: "failed" }),
    run({ status: "failed" }),
    run(),
  ];
  const result = assessObservatoryCollector(runs, now);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /3 consecutive/);
  assert.match(result.detail, /timeout/);
});

test("collector is overdue after twenty minutes without success", () => {
  const result = assessObservatoryCollector(
    [run({ completed_at: "2026-08-12T01:39:59Z" })],
    now,
  );
  assert.equal(result.status, "overdue");
});

test("collector remains healthy with fewer than three failures and a recent success", () => {
  const result = assessObservatoryCollector(
    [run({ status: "failed" }), run({ status: "failed" }), run()],
    now,
  );
  assert.equal(result.status, "healthy");
});

test("API alerts on the second consecutive failed check and recovers on success", () => {
  const first = assessObservatoryApi(false, 0);
  assert.equal(first.status, "healthy");
  assert.equal(first.recoveryEligible, false);
  const second = assessObservatoryApi(false, first.consecutiveFailures);
  assert.equal(second.status, "failed");
  const recovered = assessObservatoryApi(true, second.consecutiveFailures);
  assert.equal(recovered.status, "healthy");
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.recoveryEligible, true);
});

test("multi-source collector health uses cadence-relative API status", () => {
  const healthy = assessObservatoryCollectors([
    { collector: "usgs", status: "healthy", consecutive_failures: 0 },
    { collector: "celestrak", status: "delayed", consecutive_failures: 0 },
  ]);
  assert.equal(healthy.status, "healthy");
  const stale = assessObservatoryCollectors([
    { collector: "swpc", status: "stale", consecutive_failures: 0 },
  ]);
  assert.equal(stale.status, "overdue");
  const underThreshold = assessObservatoryCollectors([
    { collector: "nws_alerts", status: "failing", consecutive_failures: 2 },
  ]);
  assert.equal(underThreshold.status, "healthy");
  const failed = assessObservatoryCollectors([
    { collector: "nws_alerts", status: "failing", consecutive_failures: 3 },
  ]);
  assert.equal(failed.status, "failed");
});
