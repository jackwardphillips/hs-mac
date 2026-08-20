const scheduledHours = new Set([0, 2, 6, 8, 10, 12, 14, 16, 18, 20, 22]);
const defaultTimeZone = "America/New_York";
const defaultGraceMinutes = 30;

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  return Object.fromEntries(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
}

export function latestExpectedRun(
  now,
  timeZone = defaultTimeZone,
  graceMinutes = defaultGraceMinutes,
) {
  const cutoff = now.getTime() - graceMinutes * 60_000;
  const cursor = new Date(cutoff);
  cursor.setUTCMinutes(0, 0, 0);

  // Forty-eight real hours covers the longest intentional gap in the schedule
  // and both sides of a daylight-saving transition.
  for (let offset = 0; offset <= 48; offset += 1) {
    const candidate = new Date(cursor.getTime() - offset * 3_600_000);
    const local = zonedParts(candidate, timeZone);
    if (local.minute === 0 && scheduledHours.has(local.hour)) {
      return candidate;
    }
  }

  throw new Error("Could not determine the latest scheduled poller run");
}

function failureCount(record) {
  return (
    Number(record?.ingestion?.failed ?? 0) +
    Number(record?.targets?.failed ?? 0) +
    Number(record?.ebirdHttp?.failures ?? 0) +
    Number(record?.summarization?.failed ?? 0)
  );
}

function runSucceeded(record) {
  return record?.status === "success" && failureCount(record) === 0;
}

export function scheduledRunSlots(now, options = {}) {
  const timeZone = options.timeZone ?? defaultTimeZone;
  const graceMinutes = options.graceMinutes ?? defaultGraceMinutes;
  const windowHours = options.windowHours ?? 72;
  const windowStart = now.getTime() - windowHours * 3_600_000;
  const cutoff = now.getTime() - graceMinutes * 60_000;
  const cursor = new Date(windowStart);
  cursor.setUTCMinutes(0, 0, 0);
  if (cursor.getTime() < windowStart) {
    cursor.setTime(cursor.getTime() + 3_600_000);
  }

  const slots = [];
  for (
    let timestamp = cursor.getTime();
    timestamp <= cutoff;
    timestamp += 3_600_000
  ) {
    const candidate = new Date(timestamp);
    const local = zonedParts(candidate, timeZone);
    if (local.minute === 0 && scheduledHours.has(local.hour)) {
      slots.push(candidate);
    }
  }
  return slots;
}

export function threeDaySuccess(records, now = new Date(), options = {}) {
  const graceMinutes = options.graceMinutes ?? defaultGraceMinutes;
  const slots = scheduledRunSlots(now, options);
  const validRecords = records.filter((record) =>
    Number.isFinite(Date.parse(record?.startedAt ?? record?.finishedAt)),
  );
  const successfulSlots = slots.filter((slot) => {
    const earliest = slot.getTime() - 60_000;
    const latest = slot.getTime() + graceMinutes * 60_000;
    return validRecords.some((record) => {
      const startedAt = Date.parse(record.startedAt ?? record.finishedAt);
      return startedAt >= earliest && startedAt <= latest && runSucceeded(record);
    });
  }).length;

  return {
    successful: successfulSlots,
    expected: slots.length,
    percentage: slots.length === 0
      ? null
      : Math.round((successfulSlots / slots.length) * 100),
  };
}

export function classify(records, now = new Date(), options = {}) {
  const timeZone = options.timeZone ?? defaultTimeZone;
  const graceMinutes = options.graceMinutes ?? defaultGraceMinutes;
  const validRecords = records
    .filter((record) => Number.isFinite(Date.parse(record?.finishedAt)))
    .sort((left, right) => Date.parse(right.finishedAt) - Date.parse(left.finishedAt));

  if (validRecords.length === 0) {
    return {
      healthy: false,
      status: "Unknown",
      reason: "No completed runs recorded",
      latest: null,
      recent: [],
      records: [],
    };
  }

  const latest = validRecords[0];
  const expected = latestExpectedRun(now, timeZone, graceMinutes);
  if (Date.parse(latest.finishedAt) < expected.getTime()) {
    return {
      healthy: false,
      status: "Stale",
      reason: `No completed run since ${expected.toISOString()}`,
      latest,
      recent: validRecords.slice(0, 10),
      records: validRecords,
    };
  }

  if (latest.status !== "success") {
    return {
      healthy: false,
      status: "Failed",
      reason: "The latest run did not complete successfully",
      latest,
      recent: validRecords.slice(0, 10),
      records: validRecords,
    };
  }

  const failures = failureCount(latest);
  if (failures > 0) {
    return {
      healthy: false,
      status: "Degraded",
      reason: `The latest run recorded ${failures} failure${failures === 1 ? "" : "s"}`,
      latest,
      recent: validRecords.slice(0, 10),
      records: validRecords,
    };
  }

  return {
    healthy: true,
    status: "Healthy",
    reason: "The latest scheduled run completed successfully",
    latest,
    recent: validRecords.slice(0, 10),
    records: validRecords,
  };
}

function relativeTime(isoDate, now) {
  const seconds = Math.max(0, Math.floor((now.getTime() - Date.parse(isoDate)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function summarize(classification, now = new Date()) {
  const { latest, records } = classification;
  const success = threeDaySuccess(records, now);
  const attempts = Number(latest?.ebirdHttp?.attempts ?? 0);
  const failures = Number(latest?.ebirdHttp?.failures ?? 0);
  const summariesUpdated = Number(latest?.summarization?.updated ?? 0);

  return {
    status: classification.status,
    reason: classification.reason,
    lastRun: latest ? relativeTime(latest.finishedAt, now) : "never",
    threeDaySuccess: success.percentage === null
      ? "Unknown"
      : `${success.percentage}% (${success.successful} / ${success.expected})`,
    ebirdCalls: `${Math.max(0, attempts - failures)} / ${attempts}`,
    summaries: `${summariesUpdated} updated`,
    lastRunAt: latest?.finishedAt ?? null,
    alertPollRunId: latest?.alertPollRunId ?? null,
  };
}
