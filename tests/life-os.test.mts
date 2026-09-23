import assert from "node:assert/strict";
import { localTimeFallsInQuietHours, nextOccurrence, notificationBucket } from "../src/lib/life-os.ts";

assert.equal(nextOccurrence("2026-09-23T10:00:00.000Z","daily",1), "2026-09-24T10:00:00.000Z");
assert.equal(nextOccurrence("2026-09-23T10:00:00.000Z","weekly",1), "2026-09-30T10:00:00.000Z");
assert.equal(nextOccurrence("2026-01-31T10:00:00.000Z","monthly",1), "2026-02-28T10:00:00.000Z");
assert.equal(nextOccurrence("2026-09-23T10:00:00.000Z","none",1), null);

assert.equal(localTimeFallsInQuietHours("23:30","22:00","08:00"), true);
assert.equal(localTimeFallsInQuietHours("07:30","22:00","08:00"), true);
assert.equal(localTimeFallsInQuietHours("12:00","22:00","08:00"), false);
assert.equal(localTimeFallsInQuietHours("13:30","13:00","14:00"), true);

assert.equal(notificationBucket("2026-09-23T08:00:00.000Z","2026-09-23T09:00:00.000Z"), "urgent");
assert.equal(notificationBucket("2026-09-23T18:00:00.000Z","2026-09-23T09:00:00.000Z"), "today");
assert.equal(notificationBucket("2026-09-24T09:00:00.000Z","2026-09-23T09:00:00.000Z"), "later");

console.log("life-os helpers: PASS");
