import { formatTimecode, formatTimeRange } from "@/lib/timecode";

/**
 * Transcript timestamps are stored as numeric seconds; these helpers exist
 * only for display. Nothing persists a formatted string.
 *
 * The implementation lives in `@/lib/timecode` so transcript segments and
 * speaker regions render identical times — a prerequisite for reading the two
 * timelines side by side.
 */

export const formatTranscriptTimestamp = formatTimecode;
export const formatTranscriptRange = formatTimeRange;
