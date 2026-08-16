import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export function formatBytes(bytes?: number): string {
  if (bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export function formatWhen(ts: number): string {
  const date = new Date(ts);
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return `Yesterday ${format(date, "HH:mm")}`;
  return format(date, "d MMM HH:mm");
}

export function formatAgo(ts: number): string {
  return formatDistanceToNowStrict(new Date(ts), { addSuffix: true });
}

export function formatDay(dateStr: string): string {
  // dateStr is "YYYY-MM-DD" in the production timezone
  const [y, m, d] = dateStr.split("-").map(Number);
  return format(new Date(y, m - 1, d), "EEEE d MMMM yyyy");
}

export function todayInTz(timezone: string): string {
  return formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
