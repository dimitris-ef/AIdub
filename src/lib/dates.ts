/**
 * Timestamps are stored as ISO 8601 strings; formatting happens at render
 * time only. Never persist a formatted date.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ABSOLUTE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function parseTimestamp(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "just now" · "12 minutes ago" · "3 days ago" · "25 Aug 2026, 15:10" */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = parseTimestamp(iso);
  if (!date) {
    return "unknown";
  }

  const elapsed = now.getTime() - date.getTime();

  if (elapsed < 0) {
    return "just now";
  }
  if (elapsed < MINUTE) {
    return "just now";
  }
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE);
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  if (elapsed < 7 * DAY) {
    const days = Math.floor(elapsed / DAY);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }

  return formatAbsoluteDateTime(iso);
}

/** "25 Aug 2026, 15:10" */
export function formatAbsoluteDateTime(iso: string): string {
  const date = parseTimestamp(iso);
  return date ? ABSOLUTE_FORMATTER.format(date) : "unknown";
}
