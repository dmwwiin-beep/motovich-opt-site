import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { getDueTaskTime, getLocalClock } from "./schedule-core.ts";

Deno.test("uses the user's winter time zone", () => {
  assertEquals(getLocalClock(new Date("2026-01-15T12:00:00Z"), "Europe/Amsterdam"), {
    date: "2026-01-15",
    minuteOfDay: 13 * 60,
  });
});

Deno.test("uses the user's summer time zone", () => {
  assertEquals(getLocalClock(new Date("2026-07-15T12:00:00Z"), "Europe/Amsterdam"), {
    date: "2026-07-15",
    minuteOfDay: 14 * 60,
  });
});

Deno.test("handles the local date boundary", () => {
  assertEquals(getLocalClock(new Date("2026-10-21T22:30:00Z"), "Europe/Amsterdam"), {
    date: "2026-10-22",
    minuteOfDay: 30,
  });
});

Deno.test("returns a task's time exactly when due", () => {
  assertEquals(getDueTaskTime({ date: "2026-10-21", time: "12:30", done: false }, "2026-10-21", 12 * 60 + 30), "12:30");
});

Deno.test("catches up for a short delay but not beyond the grace window", () => {
  const task = { date: "2026-10-21", time: "12:30" };
  assertEquals(getDueTaskTime(task, "2026-10-21", 12 * 60 + 40), "12:30");
  assertEquals(getDueTaskTime(task, "2026-10-21", 12 * 60 + 41), null);
});

Deno.test("ignores tasks for another date or a future time", () => {
  const task = { date: "2026-10-22", time: "12:30" };
  assertEquals(getDueTaskTime(task, "2026-10-21", 12 * 60 + 30), null);
  assertEquals(getDueTaskTime(task, "2026-10-22", 12 * 60 + 29), null);
});

Deno.test("ignores completed, date-only and malformed tasks", () => {
  assertEquals(getDueTaskTime({ date: "2026-10-21", time: "12:30", done: true }, "2026-10-21", 12 * 60 + 30), null);
  assertEquals(getDueTaskTime({ date: "2026-10-21" }, "2026-10-21", 12 * 60 + 30), null);
  assertEquals(getDueTaskTime({ date: "2026-10-21", time: "25:61" }, "2026-10-21", 12 * 60 + 30), null);
  assertEquals(getDueTaskTime(null, "2026-10-21", 12 * 60 + 30), null);
});

Deno.test("rejects invalid time zones", () => {
  assertThrows(() => getLocalClock(new Date("2026-10-21T12:00:00Z"), "Not/A-Timezone"));
});
