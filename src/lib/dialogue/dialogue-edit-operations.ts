import type {
  DialogueSegment,
  DialogueSpeaker,
  UnifiedDialogue,
} from "@/types/dialogue";
import { validateDialogue } from "@/lib/dialogue/dialogue-validation";

/**
 * Human corrections to the unified dialogue, as pure functions.
 *
 * Every operation takes a dialogue and returns a new one — no I/O, no
 * persistence, no React. That is what makes the hard parts (structural splits
 * and merges, speaker merging, provenance) cheap to test exhaustively, and it
 * is what lets the service persist a fully-derived, fully-validated document
 * rather than mutating one in place and hoping.
 *
 * Two rules hold throughout:
 *
 *  - **Raw inputs are never touched.** These functions cannot reach the
 *    transcript or diarization stores; they only ever see the dialogue.
 *  - **Provenance survives.** A corrected segment keeps its transcript segment
 *    id and its diarization region ids; split and merged segments record which
 *    dialogue segments they came from. What a person changed is recorded in
 *    `editMetadata` rather than being silently indistinguishable from what the
 *    merge decided.
 */

export const DIALOGUE_EDIT_CODES = [
  "SEGMENT_NOT_FOUND",
  "SPEAKER_NOT_FOUND",
  "INVALID_SPLIT_TIME",
  "INVALID_TIMING",
  "INVALID_NAME",
  "SAME_SPEAKER",
  "NOT_ADJACENT",
  "DIFFERENT_SPEAKERS",
  "INVALID_RESULT",
] as const;

export type DialogueEditCode = (typeof DIALOGUE_EDIT_CODES)[number];

export type DialogueEditResult =
  | { ok: true; dialogue: UnifiedDialogue }
  | { ok: false; code: DialogueEditCode; message: string };

export interface EditContext {
  now: () => Date;
  createId: () => string;
}

/** Longest a speaker name may be; long enough for a real name, not a note. */
export const MAX_SPEAKER_NAME_LENGTH = 80;

function fail(code: DialogueEditCode, message: string): DialogueEditResult {
  return { ok: false, code, message };
}

/**
 * Finishes an edit: re-sorts, stamps the revision, and validates. Every
 * operation goes through here, so ordering and edit metadata can never drift
 * apart from the change that caused them.
 */
function commit(
  baseline: UnifiedDialogue,
  next: Omit<UnifiedDialogue, "editMetadata" | "updatedAt">,
  context: EditContext,
): DialogueEditResult {
  const timestamp = context.now().toISOString();

  const dialogue: UnifiedDialogue = {
    ...next,
    segments: sortSegments(next.segments),
    updatedAt: timestamp,
    editMetadata: {
      hasManualEdits: true,
      // One increment per persisted correction — not per keystroke.
      revision: baseline.editMetadata.revision + 1,
      editedAt: timestamp,
      baselineAlgorithmVersion: baseline.editMetadata.baselineAlgorithmVersion,
    },
  };

  const validation = validateDialogue(dialogue, baseline);

  if (!validation.ok) {
    return fail("INVALID_RESULT", validation.message);
  }

  return { ok: true, dialogue };
}

/** The canonical order: start, then end, then the stable id. */
export function sortSegments(
  segments: readonly DialogueSegment[],
): DialogueSegment[] {
  return [...segments].sort(
    (a, b) =>
      a.startTime - b.startTime ||
      a.endTime - b.endTime ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function replaceSegment(
  dialogue: UnifiedDialogue,
  segmentId: string,
  update: (segment: DialogueSegment) => DialogueSegment,
): DialogueSegment[] | null {
  const index = dialogue.segments.findIndex(
    (segment) => segment.id === segmentId,
  );

  if (index === -1) {
    return null;
  }

  const segments = [...dialogue.segments];
  segments[index] = update(segments[index]);

  return segments;
}

/**
 * Corrects a segment's reviewed text.
 *
 * Leading and trailing whitespace is trimmed on commit; the wording itself is
 * left exactly as typed. Empty text is deliberately allowed — a false-positive
 * transcription is a real thing to correct, and blanking the line is a more
 * honest fix than inventing words for it. The segment stays in place with its
 * timing and provenance so it can still be reassigned or removed by merging.
 */
export function updateSegmentText(
  dialogue: UnifiedDialogue,
  segmentId: string,
  text: string,
  context: EditContext,
): DialogueEditResult {
  const trimmed = text.trim();
  const existing = dialogue.segments.find((entry) => entry.id === segmentId);

  if (!existing) {
    return fail("SEGMENT_NOT_FOUND", "That line no longer exists.");
  }

  // A blur that changed nothing is not a correction: returning the document
  // untouched keeps the revision from inflating every time focus moves.
  if (existing.originalText === trimmed) {
    return { ok: true, dialogue };
  }

  const segments = replaceSegment(dialogue, segmentId, (segment) => ({
    ...segment,
    originalText: trimmed,
    editMetadata: { ...segment.editMetadata, manuallyEditedText: true },
  }));

  if (!segments) {
    return fail("SEGMENT_NOT_FOUND", "That line no longer exists.");
  }

  return commit(dialogue, { ...dialogue, segments }, context);
}

/**
 * Renames a speaker.
 *
 * Only the display name changes: the stable id every segment references, and
 * every downstream system will join on, is untouched. An empty name falls back
 * to the generated default rather than leaving a nameless speaker.
 */
export function renameSpeaker(
  dialogue: UnifiedDialogue,
  speakerId: string,
  name: string,
  fallbackName: string,
  context: EditContext,
): DialogueEditResult {
  const trimmed = name.trim().slice(0, MAX_SPEAKER_NAME_LENGTH);
  const index = dialogue.speakers.findIndex(
    (speaker) => speaker.id === speakerId,
  );

  if (index === -1) {
    return fail("SPEAKER_NOT_FOUND", "That speaker no longer exists.");
  }

  const speakers = [...dialogue.speakers];
  speakers[index] = {
    ...speakers[index],
    name: trimmed.length > 0 ? trimmed : fallbackName,
    updatedAt: context.now().toISOString(),
  };

  return commit(dialogue, { ...dialogue, speakers }, context);
}

/**
 * Assigns a segment to a speaker, or to nobody.
 *
 * A manual choice is authoritative: the method becomes `manual`, the
 * uncertainty the merge reported is cleared, and what the algorithm had
 * decided is preserved under `assignment.automatic` for provenance. Overlap
 * metadata is deliberately left alone — someone choosing a primary speaker
 * does not make the overlapping speech go away, and later dubbing needs it.
 */
export function reassignSpeaker(
  dialogue: UnifiedDialogue,
  segmentId: string,
  speakerId: string | null,
  context: EditContext,
): DialogueEditResult {
  if (
    speakerId !== null &&
    !dialogue.speakers.some((speaker) => speaker.id === speakerId)
  ) {
    return fail("SPEAKER_NOT_FOUND", "That speaker no longer exists.");
  }

  const segments = replaceSegment(dialogue, segmentId, (segment) => ({
    ...segment,
    speakerId,
    assignment: {
      ...segment.assignment,
      method: speakerId === null ? "unassigned" : "manual",
      uncertain: false,
      reason: null,
      automatic: segment.assignment.automatic ?? {
        method: segment.assignment.method,
        speakerId: segment.speakerId,
        reason: segment.assignment.reason,
      },
    },
    editMetadata: { ...segment.editMetadata, manuallyEditedSpeaker: true },
  }));

  if (!segments) {
    return fail("SEGMENT_NOT_FOUND", "That line no longer exists.");
  }

  return commit(dialogue, { ...dialogue, segments }, context);
}

/**
 * Folds one speaker into another, for when diarization split one person across
 * several clusters.
 *
 * The target keeps its stable id, so nothing downstream has to be re-pointed.
 * Both clusters' diarization ids are recorded on the survivor, which is how a
 * later system learns that two model clusters were the same voice. The source
 * speaker is removed from the dialogue only — Part 6's speaker list is not
 * touched.
 */
export function mergeSpeakers(
  dialogue: UnifiedDialogue,
  sourceSpeakerId: string,
  targetSpeakerId: string,
  context: EditContext,
): DialogueEditResult {
  if (sourceSpeakerId === targetSpeakerId) {
    return fail("SAME_SPEAKER", "A speaker cannot be merged into itself.");
  }

  const source = dialogue.speakers.find(
    (speaker) => speaker.id === sourceSpeakerId,
  );
  const target = dialogue.speakers.find(
    (speaker) => speaker.id === targetSpeakerId,
  );

  if (!source || !target) {
    return fail("SPEAKER_NOT_FOUND", "That speaker no longer exists.");
  }

  const timestamp = context.now().toISOString();

  const speakers: DialogueSpeaker[] = dialogue.speakers
    .filter((speaker) => speaker.id !== sourceSpeakerId)
    .map((speaker) =>
      speaker.id === targetSpeakerId
        ? {
            ...speaker,
            sourceSpeakerIds: [
              ...new Set([
                ...speaker.sourceSpeakerIds,
                ...source.sourceSpeakerIds,
              ]),
            ],
            updatedAt: timestamp,
          }
        : speaker,
    );

  const segments = dialogue.segments.map((segment) =>
    segment.speakerId === sourceSpeakerId
      ? {
          ...segment,
          speakerId: targetSpeakerId,
          assignment: {
            ...segment.assignment,
            method: "manual" as const,
            uncertain: false,
            reason: null,
            automatic: segment.assignment.automatic ?? {
              method: segment.assignment.method,
              speakerId: segment.speakerId,
              reason: segment.assignment.reason,
            },
          },
          editMetadata: {
            ...segment.editMetadata,
            manuallyEditedSpeaker: true,
          },
        }
      : segment,
  );

  return commit(dialogue, { ...dialogue, segments, speakers }, context);
}

export interface SplitSegmentInput {
  splitTime: number;
  /** Text for the first half; the caller decides where the words divide. */
  firstText: string;
  /** Text for the second half. */
  secondText: string;
  /** Optional per-half speakers, for splitting to fix a speaker boundary. */
  firstSpeakerId?: string | null;
  secondSpeakerId?: string | null;
}

/**
 * Splits one segment into two at a point inside it.
 *
 * Timing splits exactly. **Text does not** — without word-level timings there
 * is no way to know which words fall on either side, so the caller supplies
 * both halves (the UI asks the person to place the boundary). Nothing here
 * divides text by character count or guesses.
 *
 * Both halves keep the original's transcript and region references, and record
 * the segment they came from. Ids are derived from the parent (`id:a`, `id:b`)
 * so they are deterministic and traceable rather than positional.
 */
export function splitSegment(
  dialogue: UnifiedDialogue,
  segmentId: string,
  input: SplitSegmentInput,
  context: EditContext,
): DialogueEditResult {
  const segment = dialogue.segments.find((entry) => entry.id === segmentId);

  if (!segment) {
    return fail("SEGMENT_NOT_FOUND", "That line no longer exists.");
  }

  if (
    !Number.isFinite(input.splitTime) ||
    input.splitTime <= segment.startTime ||
    input.splitTime >= segment.endTime
  ) {
    return fail(
      "INVALID_SPLIT_TIME",
      "The split point must fall inside the line.",
    );
  }

  for (const speakerId of [input.firstSpeakerId, input.secondSpeakerId]) {
    if (
      speakerId !== undefined &&
      speakerId !== null &&
      !dialogue.speakers.some((speaker) => speaker.id === speakerId)
    ) {
      return fail("SPEAKER_NOT_FOUND", "That speaker no longer exists.");
    }
  }

  const parentIds = [
    ...new Set([...segment.editMetadata.parentSegmentIds, segment.id]),
  ];

  const half = (
    suffix: "a" | "b",
    startTime: number,
    endTime: number,
    text: string,
    speakerId: string | null,
  ): DialogueSegment => ({
    ...segment,
    id: uniqueId(`${segment.id}:${suffix}`, dialogue, segmentId),
    startTime,
    endTime,
    originalText: text.trim(),
    speakerId,
    assignment:
      speakerId === segment.speakerId
        ? segment.assignment
        : {
            ...segment.assignment,
            method: speakerId === null ? "unassigned" : "manual",
            uncertain: false,
            reason: null,
            automatic: segment.assignment.automatic ?? {
              method: segment.assignment.method,
              speakerId: segment.speakerId,
              reason: segment.assignment.reason,
            },
          },
    editMetadata: {
      ...segment.editMetadata,
      manuallyChangedStructure: true,
      manuallyEditedText: true,
      manuallyEditedSpeaker:
        segment.editMetadata.manuallyEditedSpeaker ||
        speakerId !== segment.speakerId,
      parentSegmentIds: parentIds,
    },
  });

  const firstSpeaker =
    input.firstSpeakerId === undefined
      ? segment.speakerId
      : input.firstSpeakerId;
  const secondSpeaker =
    input.secondSpeakerId === undefined
      ? segment.speakerId
      : input.secondSpeakerId;

  const segments = [
    ...dialogue.segments.filter((entry) => entry.id !== segmentId),
    half("a", segment.startTime, input.splitTime, input.firstText, firstSpeaker),
    half("b", input.splitTime, segment.endTime, input.secondText, secondSpeaker),
  ];

  return commit(dialogue, { ...dialogue, segments }, context);
}

/**
 * Joins two adjacent segments into one.
 *
 * Adjacency is by timeline position, not array index, and both must belong to
 * the same speaker: silently discarding one of two different speakers'
 * attributions would be a destructive edit dressed up as a convenience. The
 * survivor spans both, joins the text in order, and inherits the union of both
 * sides' transcript and region references so nothing loses its provenance.
 */
export function mergeSegments(
  dialogue: UnifiedDialogue,
  firstSegmentId: string,
  secondSegmentId: string,
  context: EditContext,
): DialogueEditResult {
  const ordered = sortSegments(dialogue.segments);
  const firstIndex = ordered.findIndex(
    (segment) => segment.id === firstSegmentId,
  );
  const secondIndex = ordered.findIndex(
    (segment) => segment.id === secondSegmentId,
  );

  if (firstIndex === -1 || secondIndex === -1) {
    return fail("SEGMENT_NOT_FOUND", "That line no longer exists.");
  }

  if (Math.abs(firstIndex - secondIndex) !== 1) {
    return fail(
      "NOT_ADJACENT",
      "Only lines next to each other on the timeline can be merged.",
    );
  }

  const [first, second] =
    firstIndex < secondIndex
      ? [ordered[firstIndex], ordered[secondIndex]]
      : [ordered[secondIndex], ordered[firstIndex]];

  if (first.speakerId !== second.speakerId) {
    return fail(
      "DIFFERENT_SPEAKERS",
      "Lines from different speakers cannot be merged. Reassign one of them first.",
    );
  }

  const merged: DialogueSegment = {
    ...first,
    startTime: Math.min(first.startTime, second.startTime),
    endTime: Math.max(first.endTime, second.endTime),
    originalText: [first.originalText, second.originalText]
      .map((text) => text.trim())
      .filter((text) => text.length > 0)
      .join(" "),
    diarization: {
      ...first.diarization,
      regionIds: [
        ...new Set([
          ...first.diarization.regionIds,
          ...second.diarization.regionIds,
        ]),
      ],
      // Overlap anywhere in the combined range is overlap in the result.
      overlap: first.diarization.overlap || second.diarization.overlap,
    },
    editMetadata: {
      manuallyEditedText: true,
      manuallyEditedSpeaker:
        first.editMetadata.manuallyEditedSpeaker ||
        second.editMetadata.manuallyEditedSpeaker,
      manuallyEditedTiming:
        first.editMetadata.manuallyEditedTiming ||
        second.editMetadata.manuallyEditedTiming,
      manuallyChangedStructure: true,
      parentSegmentIds: [
        ...new Set([
          ...first.editMetadata.parentSegmentIds,
          ...second.editMetadata.parentSegmentIds,
          first.id,
          second.id,
        ]),
      ],
    },
  };

  const segments = [
    ...dialogue.segments.filter(
      (segment) => segment.id !== first.id && segment.id !== second.id,
    ),
    merged,
  ];

  return commit(dialogue, { ...dialogue, segments }, context);
}

export interface TimingUpdate {
  startTime: number;
  endTime: number;
}

/**
 * Corrects a segment's timing.
 *
 * Local only: neighbours are never shifted or trimmed to compensate. Overlaps
 * and gaps with adjacent lines are both legitimate outcomes and are left as
 * the person set them — the caller is told when an overlap is newly created so
 * it can warn, but nothing is silently adjusted.
 */
export function updateSegmentTiming(
  dialogue: UnifiedDialogue,
  segmentId: string,
  timing: TimingUpdate,
  context: EditContext,
  options: { mediaDuration?: number | null } = {},
): DialogueEditResult {
  const { startTime, endTime } = timing;

  if (
    !Number.isFinite(startTime) ||
    !Number.isFinite(endTime) ||
    startTime < 0 ||
    endTime <= startTime
  ) {
    return fail(
      "INVALID_TIMING",
      "A line must start at or after zero and end after it starts.",
    );
  }

  const duration = options.mediaDuration;

  if (
    typeof duration === "number" &&
    Number.isFinite(duration) &&
    duration > 0 &&
    endTime > duration + DURATION_TOLERANCE_SECONDS
  ) {
    return fail("INVALID_TIMING", "A line cannot end after the video does.");
  }

  const segments = replaceSegment(dialogue, segmentId, (segment) => ({
    ...segment,
    startTime,
    endTime,
    editMetadata: { ...segment.editMetadata, manuallyEditedTiming: true },
  }));

  if (!segments) {
    return fail("SEGMENT_NOT_FOUND", "That line no longer exists.");
  }

  return commit(dialogue, { ...dialogue, segments }, context);
}

/** Rounding room for a segment that ends exactly at the media's end. */
const DURATION_TOLERANCE_SECONDS = 0.5;

/**
 * Segments that now overlap a different speaker's line and did not before.
 * Used to warn after a timing edit rather than to prevent one.
 */
export function newlyOverlappingSegmentIds(
  before: UnifiedDialogue,
  after: UnifiedDialogue,
): string[] {
  const previous = new Set(overlappingPairs(before));

  return [...new Set(overlappingPairs(after))]
    .filter((pair) => !previous.has(pair))
    .flatMap((pair) => pair.split("::"));
}

function overlappingPairs(dialogue: UnifiedDialogue): string[] {
  const pairs: string[] = [];
  const segments = sortSegments(dialogue.segments);

  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      if (segments[j].startTime >= segments[i].endTime) {
        break;
      }

      const [a, b] = [segments[i].id, segments[j].id].sort();
      pairs.push(`${a}::${b}`);
    }
  }

  return pairs;
}

/** Keeps a derived id unique, even after repeated splits of the same line. */
function uniqueId(
  candidate: string,
  dialogue: UnifiedDialogue,
  ignoreId: string,
): string {
  const taken = new Set(
    dialogue.segments
      .filter((segment) => segment.id !== ignoreId)
      .map((segment) => segment.id),
  );

  if (!taken.has(candidate)) {
    return candidate;
  }

  let suffix = 2;
  while (taken.has(`${candidate}${suffix}`)) {
    suffix += 1;
  }

  return `${candidate}${suffix}`;
}
