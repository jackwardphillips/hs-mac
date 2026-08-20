const COLLECTOR_STALE_MS = 20 * 60 * 1000;
const COLLECTOR_FAILURE_THRESHOLD = 3;
const API_FAILURE_THRESHOLD = 2;

export function assessObservatoryCollector(runs, now = new Date()) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return {
      status: "overdue",
      detail: "No collector runs are recorded",
    };
  }

  const consecutiveFailures = runs.findIndex((run) => run.status !== "failed");
  const failureCount = consecutiveFailures === -1 ? runs.length : consecutiveFailures;
  if (failureCount >= COLLECTOR_FAILURE_THRESHOLD) {
    const latestError = runs[0]?.error?.message;
    return {
      status: "failed",
      detail: `${failureCount} consecutive collections failed${latestError ? `; latest error: ${latestError}` : ""}`,
    };
  }

  const latestSuccess = runs.find((run) => run.status === "succeeded");
  if (!latestSuccess?.completed_at) {
    return {
      status: "overdue",
      detail: "No successful collection is recorded",
    };
  }

  const completedAt = new Date(latestSuccess.completed_at);
  const ageMs = now.getTime() - completedAt.getTime();
  if (!Number.isFinite(ageMs) || ageMs > COLLECTOR_STALE_MS) {
    const completed = Number.isNaN(completedAt.getTime())
      ? "an invalid timestamp"
      : completedAt.toISOString();
    return {
      status: "overdue",
      detail: `Last successful collection completed at ${completed}`,
    };
  }

  return {
    status: "healthy",
    detail: `Latest success fetched ${latestSuccess.fetched_count}, inserted ${latestSuccess.inserted_count}, and updated ${latestSuccess.updated_count}`,
  };
}
export function assessObservatoryApi(healthy, previousFailures = 0) {
  const consecutiveFailures = healthy ? 0 : previousFailures + 1;
  return {
    consecutiveFailures,
    status: consecutiveFailures >= API_FAILURE_THRESHOLD ? "failed" : "healthy",
    recoveryEligible: healthy,
    detail: healthy
      ? "API and database health checks succeeded"
      : `${consecutiveFailures} consecutive API or database health checks failed`,
  };
}

export function assessObservatoryCollectors(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) {
    return { status: "overdue", detail: "No collector status is available", unhealthy: [] };
  }
  const unhealthy = statuses.filter((collector) =>
    collector.status === "stale" ||
    collector.status === "never_run" ||
    (collector.status === "failing" && collector.consecutive_failures >= COLLECTOR_FAILURE_THRESHOLD)
  );
  const failing = unhealthy.filter((collector) => collector.status === "failing");
  const status = failing.length > 0 ? "failed" : unhealthy.length > 0 ? "overdue" : "healthy";
  return {
    status,
    unhealthy,
    detail: unhealthy.length > 0
      ? unhealthy.map((collector) => `${collector.collector}: ${collector.status}`).join(", ")
      : `All ${statuses.length} collectors are fresh`,
  };
}
