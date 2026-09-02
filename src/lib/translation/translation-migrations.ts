import type {
  DialogueTranslation,
  DubbingTranslationMetadata,
  TranslatedDialogueSegment,
  TranslationEditMetadata,
} from "@/types/translation";
import { TRANSLATION_SCHEMA_VERSION } from "@/lib/translation/translation-config";
import { assessTranslationDuration } from "@/lib/translation/duration-warning";
import { DURATION_ESTIMATOR_VERSION } from "@/lib/translation/duration-estimator";

/**
 * Bringing a stored translation up to the current shape.
 *
 * Part 9 records carry no dubbing metadata and no edit metadata. Throwing them
 * away would be the easy option and the wrong one: the translated text in them
 * is real work that cost provider credits, and every new field has an honest
 * default.
 *
 * The defaults are chosen to say what is actually known, not to look complete:
 *
 * - `contextSegmentIds: []` — no context was used, and pretending otherwise
 *   would misreport how the text was produced;
 * - `generationMode: "initial"` — Part 9 had no other way to produce a line;
 * - `manuallyEdited: false` — Part 9 had no editing at all;
 * - the duration estimate is **computed**, not defaulted, because it is derived
 *   purely from text and language and is therefore just as valid for old text
 *   as for new.
 */

/** Duration metadata for a line, derived from the text it currently has. */
export function durationMetadataFor(
  translatedText: string,
  targetLanguage: string,
  sourceDurationSeconds: number,
): Pick<
  DubbingTranslationMetadata,
  | "estimatedDurationSeconds"
  | "sourceDurationSeconds"
  | "durationRatio"
  | "durationWarning"
  | "durationEstimatorVersion"
> {
  const assessment = assessTranslationDuration(
    translatedText,
    targetLanguage,
    sourceDurationSeconds,
  );

  return {
    estimatedDurationSeconds: assessment.estimatedSeconds,
    sourceDurationSeconds: assessment.sourceDurationSeconds,
    durationRatio: assessment.ratio,
    durationWarning: assessment.warning,
    durationEstimatorVersion: assessment.estimatorVersion,
  };
}

export function defaultEditMetadata(): TranslationEditMetadata {
  return { manuallyEdited: false, revision: 0, editedAt: null };
}

/**
 * Fills in Part 10 metadata for a segment that predates it.
 *
 * The provider and model come from the translation record, which is where
 * Part 9 stored them: provenance survives the migration rather than being
 * blanked.
 */
export function migrateSegment(
  segment: TranslatedDialogueSegment,
  translation: Pick<
    DialogueTranslation,
    "providerId" | "providerModel" | "targetLanguage" | "createdAt"
  >,
): TranslatedDialogueSegment {
  const sourceDuration = Math.max(0, segment.endTime - segment.startTime);
  const hasMetadata =
    typeof (segment as Partial<TranslatedDialogueSegment>).translationMetadata
      ?.generationMode === "string";

  if (hasMetadata && segment.editMetadata) {
    return segment;
  }

  return {
    ...segment,
    translationMetadata: {
      providerId: translation.providerId,
      providerModel: translation.providerModel,
      generationMode: "initial",
      generatedAt: translation.createdAt,
      contextSegmentIds: [],
      ...durationMetadataFor(
        segment.translatedText,
        segment.targetLanguage || translation.targetLanguage,
        sourceDuration,
      ),
      confidence: segment.confidence,
      ...(segment.providerMetadata
        ? { providerMetadata: segment.providerMetadata }
        : {}),
    },
    editMetadata: segment.editMetadata ?? defaultEditMetadata(),
  };
}

/**
 * Brings a whole stored translation to the current schema.
 *
 * Idempotent: a record already at the current version is returned as it is, so
 * this is safe to run on every read.
 */
export function migrateTranslation(
  translation: DialogueTranslation,
): DialogueTranslation {
  if (translation.version === TRANSLATION_SCHEMA_VERSION) {
    return translation;
  }

  return {
    ...translation,
    version: TRANSLATION_SCHEMA_VERSION,
    revision: translation.revision ?? 0,
    segments: translation.segments.map((segment) =>
      migrateSegment(segment, translation),
    ),
  };
}

/** True when a segment's duration metadata came from an older estimator. */
export function needsDurationRefresh(
  segment: TranslatedDialogueSegment,
): boolean {
  return (
    segment.translationMetadata.durationEstimatorVersion !==
    DURATION_ESTIMATOR_VERSION
  );
}
