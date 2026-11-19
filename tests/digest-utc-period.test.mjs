import assert from "node:assert/strict";
import test from "node:test";

import { exportDigest } from "../dist/notifications/digest-grouping.js";
import { parseSchedule, ScheduleParseError, utcPeriodFor } from "../dist/notifications/schedule.js";

function makeEvent(id, at, claimId = 1) {
  return {
    source: "market",
    contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
    version: "v1",
    ledger: 1000 + id,
    txHash: "",
    at,
    eventId: `evt-${id}`,
    eventType: "contract",
    transactionIndex: id,
    operationIndex: 0,
    inSuccessfulContractCall: true,
    payload: {
      name: "claim_created",
      claimId,
      category: "test",
      creator: "GBMGZ3D6JXIJCALSXQELCS6YUEWJWG5DFXQK5PJ5I7MWI6KVMQJBC5DLPKZI",
    },
  };
}

test("utcPeriodFor: daily schedule computes start-inclusive, end-exclusive UTC boundaries", () => {
  const schedule = parseSchedule("daily@09:00");
  const start = Date.UTC(2026, 0, 15, 9, 0, 0, 0);
  const end = Date.UTC(2026, 0, 16, 9, 0, 0, 0);

  // Exactly at startMs -> belongs to [start, end)
  const atStart = utcPeriodFor(schedule, start);
  assert.equal(atStart.startMs, start);
  assert.equal(atStart.endMs, end);
  assert.equal(atStart.startIso, "2026-01-15T09:00:00.000Z");
  assert.equal(atStart.endIso, "2026-01-16T09:00:00.000Z");

  // 1ms before endMs -> still in [start, end)
  const beforeEnd = utcPeriodFor(schedule, end - 1);
  assert.equal(beforeEnd.startMs, start);
  assert.equal(beforeEnd.endMs, end);

  // Exactly at endMs -> rolls into next period [end, end + 1d)
  const atEnd = utcPeriodFor(schedule, end);
  assert.equal(atEnd.startMs, end);
  assert.equal(atEnd.endMs, Date.UTC(2026, 0, 17, 9, 0, 0, 0));
});

test("utcPeriodFor: weekly schedule computes start-inclusive, end-exclusive UTC boundaries", () => {
  const schedule = parseSchedule("weekly@mon 12:30");
  // 2026-01-12 is a Monday
  const start = Date.UTC(2026, 0, 12, 12, 30, 0, 0);
  const end = Date.UTC(2026, 0, 19, 12, 30, 0, 0);

  const midWeek = utcPeriodFor(schedule, Date.UTC(2026, 0, 15, 0, 0, 0, 0));
  assert.equal(midWeek.startMs, start);
  assert.equal(midWeek.endMs, end);
  assert.equal(midWeek.startIso, "2026-01-12T12:30:00.000Z");
  assert.equal(midWeek.endIso, "2026-01-19T12:30:00.000Z");

  // Before Monday 12:30 -> previous week's period
  const beforeStart = utcPeriodFor(schedule, start - 1);
  assert.equal(beforeStart.startMs, Date.UTC(2026, 0, 5, 12, 30, 0, 0));
  assert.equal(beforeStart.endMs, start);
});

test("utcPeriodFor: throws ScheduleParseError on non-finite atMs", () => {
  const schedule = parseSchedule("daily@00:00");
  assert.throws(() => utcPeriodFor(schedule, Number.NaN), ScheduleParseError);
  assert.throws(() => utcPeriodFor(schedule, Number.POSITIVE_INFINITY), ScheduleParseError);
});

test("exportDigest: records explicit UTC period and filters start-inclusive, end-exclusive", () => {
  const schedule = parseSchedule("daily@00:00");
  const period = utcPeriodFor(schedule, Date.UTC(2026, 2, 10, 12, 0, 0, 0));

  const before = makeEvent(1, period.startMs - 1, 1);
  const atStart = makeEvent(2, period.startMs, 1);
  const inside = makeEvent(3, period.startMs + 60_000, 2);
  const atEnd = makeEvent(4, period.endMs, 2);

  const exported = exportDigest([before, atStart, inside, atEnd], period);

  assert.deepEqual(exported.period, {
    startMs: period.startMs,
    endMs: period.endMs,
    startIso: "2026-03-10T00:00:00.000Z",
    endIso: "2026-03-11T00:00:00.000Z",
  });
  assert.equal(exported.eventCount, 2);
  assert.equal(exported.groups.length, 2);
  assert.equal(exported.groups[0].key, "market:1");
  assert.equal(exported.groups[0].events[0].eventId, "evt-2");
  assert.equal(exported.groups[1].key, "market:2");
  assert.equal(exported.groups[1].events[0].eventId, "evt-3");
});

test("exportDigest: throws RangeError on invalid period boundaries", () => {
  const t = Date.UTC(2026, 0, 1, 0, 0, 0, 0);
  assert.throws(() => exportDigest([], { startMs: t, endMs: t }), RangeError);
  assert.throws(() => exportDigest([], { startMs: t + 1, endMs: t }), RangeError);
  assert.throws(() => exportDigest([], { startMs: Number.NaN, endMs: t }), RangeError);
});
