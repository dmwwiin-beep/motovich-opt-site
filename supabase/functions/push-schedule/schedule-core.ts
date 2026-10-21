export interface LocalClock {
  date: string;
  minuteOfDay: number;
}

export interface SchedulableTask {
  id?: unknown;
  name?: unknown;
  date?: unknown;
  time?: unknown;
  done?: unknown;
}

export function getLocalClock(now: Date, timeZone: string): LocalClock {
  if (!Number.isFinite(now.getTime())) throw new Error("invalid_timestamp");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: map.year + "-" + map.month + "-" + map.day,
    minuteOfDay: Number(map.hour) * 60 + Number(map.minute),
  };
}

/**
 * Return the scheduled HH:mm time only while a task is due or within the
 * catch-up window. Tasks without an explicit date/time never trigger.
 */
export function getDueTaskTime(
  task: SchedulableTask | null | undefined,
  localDate: string,
  minuteOfDay: number,
  lateWindowMinutes = 10,
): string | null {
  if (!task || typeof task !== "object" || task.done === true) return null;
  const date = String(task.date || "");
  const time = String(task.time || "");
  if (date !== localDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  if (!Number.isFinite(minuteOfDay) || !Number.isFinite(lateWindowMinutes) || lateWindowMinutes < 0) return null;
  const dueMinute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const delay = minuteOfDay - dueMinute;
  return delay >= 0 && delay <= lateWindowMinutes ? time : null;
}
