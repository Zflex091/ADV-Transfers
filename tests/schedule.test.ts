import assert from "node:assert/strict";
import test from "node:test";

import {
  ScheduleError,
  getEarliestVilniusPickup,
  validatePickupSchedule,
} from "../src/domain/schedule.ts";

function errorCode(expected: ScheduleError["code"]) {
  return (error: unknown) =>
    error instanceof ScheduleError && error.code === expected;
}

test("Vilnius pickup accepts exactly 30 minutes and rejects a minute less", () => {
  const nowMs = Date.parse("2026-09-23T12:00:00.000Z");
  assert.equal(
    validatePickupSchedule("2026-09-23", "15:30", nowMs).scheduledAtUtc,
    "2026-09-23T12:30:00.000Z",
  );
  assert.throws(
    () => validatePickupSchedule("2026-09-23", "15:29", nowMs),
    errorCode("too-soon"),
  );
  assert.throws(
    () => validatePickupSchedule("2026-09-23", "14:59", nowMs),
    errorCode("too-soon"),
  );
});

test("earliest Vilnius pickup rounds seconds upward and crosses midnight", () => {
  assert.deepEqual(
    getEarliestVilniusPickup(Date.parse("2026-09-23T20:50:01.000Z")),
    {
      date: "2026-09-24",
      time: "00:21",
      scheduledAtUtc: "2026-09-23T21:21:00.000Z",
    },
  );
});

test("invalid calendar dates and clock times are rejected", () => {
  const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
  assert.throws(
    () => validatePickupSchedule("2026-02-30", "12:00", nowMs),
    errorCode("invalid-date"),
  );
  assert.throws(
    () => validatePickupSchedule("2026-02-28", "24:00", nowMs),
    errorCode("invalid-time"),
  );
});

test("spring DST gap is rejected and earliest choice jumps to 04:00", () => {
  const nowMs = Date.parse("2026-03-29T00:30:00.000Z");
  assert.throws(
    () => validatePickupSchedule("2026-03-29", "03:30", nowMs),
    errorCode("nonexistent-time"),
  );
  assert.deepEqual(getEarliestVilniusPickup(nowMs), {
    date: "2026-03-29",
    time: "04:00",
    scheduledAtUtc: "2026-03-29T01:00:00.000Z",
  });
});

test("autumn DST fold is rejected and earliest choice skips ambiguous hour", () => {
  const nowMs = Date.parse("2026-10-25T01:30:00.000Z");
  assert.throws(
    () => validatePickupSchedule("2026-10-25", "03:30", nowMs),
    errorCode("ambiguous-time"),
  );
  assert.deepEqual(getEarliestVilniusPickup(nowMs), {
    date: "2026-10-25",
    time: "04:00",
    scheduledAtUtc: "2026-10-25T02:00:00.000Z",
  });
  assert.equal(
    validatePickupSchedule("2026-10-25", "04:00", nowMs).scheduledAtUtc,
    "2026-10-25T02:00:00.000Z",
  );
});
