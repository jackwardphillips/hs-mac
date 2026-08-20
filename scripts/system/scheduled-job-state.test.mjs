import assert from "node:assert/strict";
import test from "node:test";
import { reconcileJobStatus } from "./scheduled-job-state.mjs";

test("a green run recovers an unhealthy job", () => {
  assert.equal(reconcileJobStatus("failed", "healthy", true), "healthy");
  assert.equal(reconcileJobStatus("overdue", "healthy", true), "healthy");
});

test("a non-green healthy observation does not recover an unhealthy job", () => {
  assert.equal(reconcileJobStatus("failed", "healthy", false), "failed");
  assert.equal(reconcileJobStatus("overdue", "healthy", false), "overdue");
});

test("a non-green healthy observation remains healthy when there is nothing to recover", () => {
  assert.equal(reconcileJobStatus("healthy", "healthy", false), "healthy");
});
