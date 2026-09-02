import type { DialogueSpeaker, UnifiedDialogue } from "@/types/dialogue";
import { speakerDisplayName } from "@/types/dialogue";
import type {
  DialogueTranslation,
  TranslationContextSegment,
  TranslationSegmentContext,
} from "@/types/translation";

/**
 * Builds the conversation around a line.
 *
 * Why this exists at all: translating a line on its own throws away everything
 * needed to translate it well. "Yes, he said he'll come." cannot be rendered
 * correctly without knowing who "he" is, whether the speakers are on formal
 * terms, and what was actually asked. The surrounding lines carry that, so they
 * travel with the request.
 *
 * Three rules shape it:
 *
 * - **Structured, never flattened.** Each neighbour keeps its id, speaker and
 *   position. Merging them into a paragraph is how a provider loses track of
 *   which line it was asked about.
 * - **Bounded.** A fixed window, trimmed from the outside in. Sending a whole
 *   project to translate one line costs money, adds latency, and gives a model
 *   more opportunity to rewrite things nobody asked about.
 * - **Current.** Context comes from the editable dialogue — the corrected text
 *   a person actually reviewed — and never from the raw Part 5 transcript.
 *
 * Pure and provider-independent: no adapter is imported here, and the same
 * dialogue always produces the same context.
 */

export interface TranslationContextConfig {
  previousSegmentCount: number;
  nextSegmentCount: number;
  /**
   * Ceiling on the source text carried as context, in characters.
   *
   * Providers have context limits and every character is paid for. When the
   * window exceeds this, the farthest neighbours are dropped first: the lines
   * immediately around the target are the ones carrying the pronouns and the
   * replies, so they are the last to go.
   */
  maxContextCharacters: number;
  /**
   * How many earlier lines by the same speaker may be added beyond the window,
   * to keep one character's register consistent across a scene.
   */
  speakerHistoryCount: number;
}

/**
 * Chosen deliberately:
 *
 * - three lines either side — enough to carry a question, its answer and the
 *   reaction, which is where most ambiguity in dialogue actually lives, while
 *   keeping a batch request small enough to stay cheap and fast.
 * - 4000 characters — roughly a scene's worth of dialogue; large enough that
 *   the window is almost never trimmed in practice, small enough that a
 *   pathological run of long lines cannot blow up a request.
 * - two same-speaker lines — enough to establish how a character talks without
 *   dragging half the film into every request.
 */
export const DEFAULT_TRANSLATION_CONTEXT_CONFIG: TranslationContextConfig = {
  previousSegmentCount: 3,
  nextSegmentCount: 3,
  maxContextCharacters: 4000,
  speakerHistoryCount: 2,
};

export function resolveTranslationContextConfig(
  overrides: Partial<TranslationContextConfig> = {},
): TranslationContextConfig {
  return { ...DEFAULT_TRANSLATION_CONTEXT_CONFIG, ...overrides };
}

function toContextSegment(
  segment: UnifiedDialogue["segments"][number],
  speakers: readonly DialogueSpeaker[],
  translationBySegmentId: ReadonlyMap<string, string>,
): TranslationContextSegment {
  const existing = translationBySegmentId.get(segment.id);

  return {
    segmentId: segment.id,
    speakerId: segment.speakerId,
    // A label for prompting. The id is what anything actually joins on, and
    // the name is resolved fresh from the dialogue so a rename shows through.
    speakerName: speakerDisplayName(speakers, segment.speakerId),
    startTime: segment.startTime,
    endTime: segment.endTime,
    sourceText: segment.originalText,
    ...(existing !== undefined && existing.length > 0
      ? { existingTranslation: existing }
      : {}),
  };
}

/** Index of the translations that already exist, keyed by dialogue segment. */
export function existingTranslationsBySegment(
  translation: DialogueTranslation | null,
): Map<string, string> {
  const index = new Map<string, string>();

  for (const segment of translation?.segments ?? []) {
    index.set(segment.dialogueSegmentId, segment.translatedText);
  }

  return index;
}

/** Total source characters a context carries, used for trimming. */
function contextCharacters(context: TranslationSegmentContext): number {
  const all = [
    ...context.previousSegments,
    ...context.nextSegments,
    ...(context.currentSpeakerRecentSegments ?? []),
  ];

  return all.reduce(
    (total, segment) =>
      total + segment.sourceText.length + (segment.existingTranslation?.length ?? 0),
    0,
  );
}

/**
 * Trims from the outside in until the context fits.
 *
 * Speaker history goes first — it is the weakest signal — then the farthest
 * neighbours, alternating so the window stays roughly balanced around the
 * target. The immediately adjacent lines are never dropped while anything else
 * remains, and the segment being translated is never touched: it is not part of
 * the context in the first place.
 */
function trimToBudget(
  context: TranslationSegmentContext,
  maxCharacters: number,
): TranslationSegmentContext {
  const trimmed: TranslationSegmentContext = {
    previousSegments: [...context.previousSegments],
    nextSegments: [...context.nextSegments],
    ...(context.currentSpeakerRecentSegments
      ? { currentSpeakerRecentSegments: [...context.currentSpeakerRecentSegments] }
      : {}),
    sceneSummary: context.sceneSummary ?? null,
  };

  while (contextCharacters(trimmed) > maxCharacters) {
    if (trimmed.currentSpeakerRecentSegments?.length) {
      trimmed.currentSpeakerRecentSegments.shift();
      continue;
    }

    const previousCount = trimmed.previousSegments.length;
    const nextCount = trimmed.nextSegments.length;

    if (previousCount === 0 && nextCount === 0) {
      break;
    }

    // Drop from whichever side is longer, and from its far edge.
    if (previousCount >= nextCount) {
      trimmed.previousSegments.shift();
    } else {
      trimmed.nextSegments.pop();
    }
  }

  return trimmed;
}

export interface BuildContextOptions {
  config?: Partial<TranslationContextConfig>;
  /** Existing translations, so neighbours can be shown in the target language. */
  translation?: DialogueTranslation | null;
}

/**
 * The context for one dialogue segment.
 *
 * The target segment itself is deliberately **not** included: it is the thing
 * being translated and travels in `segments`, so repeating it here would invite
 * a provider to treat it as background.
 *
 * Returns null when the segment does not belong to this dialogue — a caller
 * asking about a segment from somewhere else is a bug, not something to answer
 * with an empty context.
 */
export function buildSegmentContext(
  dialogue: UnifiedDialogue,
  segmentId: string,
  { config = {}, translation = null }: BuildContextOptions = {},
): TranslationSegmentContext | null {
  const resolved = resolveTranslationContextConfig(config);
  const index = dialogue.segments.findIndex(
    (segment) => segment.id === segmentId,
  );

  if (index === -1) {
    return null;
  }

  const translations = existingTranslationsBySegment(translation);
  const toContext = (segment: UnifiedDialogue["segments"][number]) =>
    toContextSegment(segment, dialogue.speakers, translations);

  const previousSegments = dialogue.segments
    .slice(Math.max(0, index - resolved.previousSegmentCount), index)
    .map(toContext);
  const nextSegments = dialogue.segments
    .slice(index + 1, index + 1 + resolved.nextSegmentCount)
    .map(toContext);

  const speakerId = dialogue.segments[index].speakerId;
  const windowIds = new Set([
    ...previousSegments.map((segment) => segment.segmentId),
    ...nextSegments.map((segment) => segment.segmentId),
    segmentId,
  ]);

  // Earlier lines by the same speaker, nearest first, excluding anything the
  // window already carries. Unassigned lines have no character to be
  // consistent with, so they get no speaker history.
  const currentSpeakerRecentSegments =
    speakerId === null || resolved.speakerHistoryCount <= 0
      ? []
      : dialogue.segments
          .slice(0, index)
          .filter(
            (segment) =>
              segment.speakerId === speakerId && !windowIds.has(segment.id),
          )
          .slice(-resolved.speakerHistoryCount)
          .map(toContext);

  return trimToBudget(
    {
      previousSegments,
      nextSegments,
      ...(currentSpeakerRecentSegments.length > 0
        ? { currentSpeakerRecentSegments }
        : {}),
      // Aidub performs no scene analysis; claiming a summary it never made
      // would be worse than admitting there isn't one.
      sceneSummary: null,
    },
    resolved.maxContextCharacters,
  );
}

/**
 * Context for a whole batch of lines.
 *
 * A batch already contains its own interior context — the lines are
 * consecutive — so only the boundaries need filling in: what came before the
 * first line and what follows the last. Everything in the batch is excluded, so
 * no line ever appears as both "translate this" and "background".
 */
export function buildBatchContext(
  dialogue: UnifiedDialogue,
  batchSegmentIds: readonly string[],
  { config = {}, translation = null }: BuildContextOptions = {},
): TranslationSegmentContext | null {
  const resolved = resolveTranslationContextConfig(config);

  if (batchSegmentIds.length === 0) {
    return null;
  }

  const positions = batchSegmentIds
    .map((id) => dialogue.segments.findIndex((segment) => segment.id === id))
    .filter((position) => position !== -1);

  if (positions.length === 0) {
    return null;
  }

  const first = Math.min(...positions);
  const last = Math.max(...positions);
  const translations = existingTranslationsBySegment(translation);
  const toContext = (segment: UnifiedDialogue["segments"][number]) =>
    toContextSegment(segment, dialogue.speakers, translations);
  const batch = new Set(batchSegmentIds);

  return trimToBudget(
    {
      previousSegments: dialogue.segments
        .slice(Math.max(0, first - resolved.previousSegmentCount), first)
        .filter((segment) => !batch.has(segment.id))
        .map(toContext),
      nextSegments: dialogue.segments
        .slice(last + 1, last + 1 + resolved.nextSegmentCount)
        .filter((segment) => !batch.has(segment.id))
        .map(toContext),
      sceneSummary: null,
    },
    resolved.maxContextCharacters,
  );
}

/** Every segment id a context refers to, for persistence and auditing. */
export function contextSegmentIds(
  context: TranslationSegmentContext | null,
): string[] {
  if (!context) {
    return [];
  }

  return [
    ...context.previousSegments,
    ...(context.currentSpeakerRecentSegments ?? []),
    ...context.nextSegments,
  ].map((segment) => segment.segmentId);
}

/**
 * Checks a context against the dialogue it claims to describe.
 *
 * Guards the case that matters: a context built from an earlier revision, or
 * from another project's dialogue, being used to translate this one. Stale
 * context does not fail loudly on its own — it quietly produces a translation
 * informed by lines that no longer exist.
 */
export function validateContext(
  dialogue: UnifiedDialogue,
  context: TranslationSegmentContext | null,
): { ok: true } | { ok: false; details: string } {
  if (!context) {
    return { ok: true };
  }

  const known = new Map(
    dialogue.segments.map((segment) => [segment.id, segment.originalText]),
  );

  for (const segment of [
    ...context.previousSegments,
    ...context.nextSegments,
    ...(context.currentSpeakerRecentSegments ?? []),
  ]) {
    const current = known.get(segment.segmentId);

    if (current === undefined) {
      return {
        ok: false,
        details: `context segment ${segment.segmentId} is not in this dialogue`,
      };
    }

    if (current !== segment.sourceText) {
      return {
        ok: false,
        details: `context segment ${segment.segmentId} no longer matches the dialogue`,
      };
    }
  }

  return { ok: true };
}
