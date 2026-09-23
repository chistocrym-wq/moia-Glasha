export type Recurrence = "none" | "daily" | "weekly" | "monthly";

export function nextOccurrence(currentIso: string, recurrence: Recurrence, interval = 1) {
  const current = new Date(currentIso);
  if (Number.isNaN(current.getTime()) || recurrence === "none") return null;
  const next = new Date(current);
  if (recurrence === "daily") next.setUTCDate(next.getUTCDate() + interval);
  if (recurrence === "weekly") next.setUTCDate(next.getUTCDate() + 7 * interval);
  if (recurrence === "monthly") {
    const originalDay = next.getUTCDate();
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + interval);
    const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
    next.setUTCDate(Math.min(originalDay, lastDay));
  }
  return next.toISOString();
}

export function notificationBucket(deliverAt: string, nowIso = new Date().toISOString()) {
  const now = new Date(nowIso);
  const at = new Date(deliverAt);
  if (at.getTime() <= now.getTime()) return "urgent" as const;
  if (
    at.getUTCFullYear() === now.getUTCFullYear() &&
    at.getUTCMonth() === now.getUTCMonth() &&
    at.getUTCDate() === now.getUTCDate()
  ) return "today" as const;
  return "later" as const;
}

export function localTimeFallsInQuietHours(localHHMM: string, startHHMM: string, endHHMM: string) {
  const toMinutes = (value: string) => {
    const [h,m] = value.slice(0,5).split(":").map(Number);
    return h * 60 + m;
  };
  const value=toMinutes(localHHMM), start=toMinutes(startHHMM), end=toMinutes(endHHMM);
  if (start === end) return true;
  return start < end ? value >= start && value < end : value >= start || value < end;
}
