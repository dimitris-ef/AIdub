/**
 * Interval arithmetic on the shared timeline.
 *
 * Every temporal comparison in the merge goes through these helpers so the
 * rules live in one tested place rather than being re-derived at each call
 * site. All values are seconds as finite numbers — the canonical unit shared
 * by transcript segments, speaker regions and dialogue segments alike.
 */

export interface Interval {
  startTime: number;
  endTime: number;
}

export function duration(interval: Interval): number {
  return Math.max(0, interval.endTime - interval.startTime);
}

/** Seconds two intervals share. Zero when they merely touch or are apart. */
export function overlapDuration(a: Interval, b: Interval): number {
  return Math.max(
    0,
    Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime),
  );
}

export function intervalsOverlap(a: Interval, b: Interval): boolean {
  return overlapDuration(a, b) > 0;
}

/** Seconds separating two intervals; zero when they touch or overlap. */
export function gapBetween(a: Interval, b: Interval): number {
  if (intervalsOverlap(a, b)) {
    return 0;
  }

  return a.endTime <= b.startTime
    ? b.startTime - a.endTime
    : a.startTime - b.endTime;
}

/**
 * Total seconds covered by a set of intervals, counting shared time once.
 * Used wherever overlapping regions must not inflate a duration.
 */
export function unionDuration(intervals: readonly Interval[]): number {
  const sorted = [...intervals]
    .filter((interval) => duration(interval) > 0)
    .sort((a, b) => a.startTime - b.startTime);

  let total = 0;
  let currentStart = Number.NaN;
  let currentEnd = Number.NaN;

  for (const interval of sorted) {
    if (Number.isNaN(currentStart)) {
      currentStart = interval.startTime;
      currentEnd = interval.endTime;
      continue;
    }

    if (interval.startTime > currentEnd) {
      total += currentEnd - currentStart;
      currentStart = interval.startTime;
      currentEnd = interval.endTime;
      continue;
    }

    currentEnd = Math.max(currentEnd, interval.endTime);
  }

  if (!Number.isNaN(currentStart)) {
    total += currentEnd - currentStart;
  }

  return total;
}

/**
 * Seconds of `subject` that fall inside `bounds` but outside every interval in
 * `exclude`. This is how a competing speaker's *exclusive* speech is measured:
 * time where they speak and the leading speaker does not.
 */
export function exclusiveOverlapDuration(
  subject: readonly Interval[],
  bounds: Interval,
  exclude: readonly Interval[],
): number {
  const clipped = subject
    .map((interval) => clip(interval, bounds))
    .filter((interval): interval is Interval => interval !== null);

  const excluded = exclude
    .map((interval) => clip(interval, bounds))
    .filter((interval): interval is Interval => interval !== null);

  const covered = unionDuration(clipped);

  if (covered === 0) {
    return 0;
  }

  // |subject \ exclude| = |subject ∪ exclude| − |exclude|. Going through the
  // unions keeps overlapping intervals on either side from counting twice.
  const exclusive =
    unionDuration([...clipped, ...excluded]) - unionDuration(excluded);

  return Math.max(0, Math.min(covered, exclusive));
}

function clip(interval: Interval, bounds: Interval): Interval | null {
  const startTime = Math.max(interval.startTime, bounds.startTime);
  const endTime = Math.min(interval.endTime, bounds.endTime);

  return endTime > startTime ? { startTime, endTime } : null;
}

export function isValidInterval(interval: Interval): boolean {
  return (
    Number.isFinite(interval.startTime) &&
    Number.isFinite(interval.endTime) &&
    interval.startTime >= 0 &&
    interval.endTime >= interval.startTime
  );
}
