import assert from "node:assert/strict";
import test from "node:test";
import { relativeTime } from "./system-update.mjs";

test("formats recent update checks in minutes", () => {
  assert.equal(
    relativeTime("2026-07-30T18:00:00Z", new Date("2026-07-30T18:42:00Z")),
    "42m ago",
  );
});

test("formats older update checks in hours and days", () => {
  assert.equal(
    relativeTime("2026-07-30T12:00:00Z", new Date("2026-07-30T18:42:00Z")),
    "6h ago",
  );
  assert.equal(
    relativeTime("2026-07-28T12:00:00Z", new Date("2026-07-30T18:42:00Z")),
    "2d ago",
  );
});

