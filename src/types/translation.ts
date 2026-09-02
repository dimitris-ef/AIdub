/**
 * Dialogue translation domain model.
 *
 * Part 9 answers one question: **what is the translated text for each existing
 * dialogue segment?** Everything else about a segment — who said it, when, and
 * what they said in the source language — already exists and is preserved
 * verbatim.
 *
 * Two rules shape this model:
 *
 * 1. **The input is the current editable `UnifiedDialogue`**, not the raw Part 5
 *    transcript. Everything a person corrected in Part 8 — text, speaker,
 *    timing, split/merged structure — is what gets translated.
 * 2. **Nothing here is ever written back into the dialogue.**
 *    `DialogueSegment.originalText` stays untouched; the translation lives in
 *    its own record so that both languages are available at once to voice
 *    assignment, TTS, timing and export.
 *
 * A translation is therefore *derived and disposable*: it can always be thrown
 * away and produced again from the dialogue it names. Which is exactly why it
 * records the dialogue revision it translated — see
 * `@/lib/translation/translation-staleness`.
 *
 * Part 9 is deliberately **segment-preserving**: one translated segment per
 * dialogue segment, same ids, same speakers, same timestamps. Dubbing-aware
 * rewriting — shortening to fit a take, lip-sync phrasing, scene context — is
 * Part 10's job and needs this layer underneath it first.
 */

import type { TranslationDurationWarning } from "@/lib/translation/duration-warning";

export type { TranslationDurationWarning };

export const TRANSLATION_STATUSES = [
  "processing",
  "completed",
  "failed",
] as const;

export type TranslationStatus = (typeof TRANSLATION_STATUSES)[number];

/**
 * What a provider reported about the work it did.
 *
 * Every field is optional because providers genuinely differ: a character-billed
 * machine-translation API has no tokens, and a self-hosted model may report
 * nothing at all. Nothing here is ever estimated to fill a gap — an absent
 * measurement stays absent, and the whole object is null when a provider
 * reports nothing. Part 9 records usage; it does not price it.
 */
export interface TranslationUsage {
  inputCharacters?: number;
  outputCharacters?: number;
  inputTokens?: number;
  outputTokens?: number;
  /** How many provider calls the translation took, batching included. */
  requestCount?: number;
  providerMetadata?: Record<string, unknown>;
}

/**
 * Why a line's current translation exists.
 *
 * Recorded so provenance survives: a line the user shortened, a line they
 * regenerated and a line from the original full run are all "translated", but
 * they got there differently, and that matters when reviewing the result.
 */
export const TRANSLATION_GENERATION_MODES = [
  "initial",
  "regenerate",
  "shorter",
] as const;

export type TranslationGenerationMode =
  (typeof TRANSLATION_GENERATION_MODES)[number];

/**
 * What produced a line's translation, and how well it is likely to fit.
 *
 * The duration fields are **derived**: they can be recomputed from the text at
 * any time and are refreshed on every change to it. They are an estimate from
 * text, never a measurement of synthesised speech — see
 * `@/lib/translation/duration-estimator`.
 */
export interface DubbingTranslationMetadata {
  providerId: string;
  providerModel: string | null;
  generationMode: TranslationGenerationMode;
  generatedAt: string;
  /**
   * The dialogue segments whose text was given to the provider as surrounding
   * context. Ids only: the text itself lives in the dialogue, and duplicating
   * it here would go stale the moment the dialogue was edited.
   */
  contextSegmentIds: string[];
  /** Estimated seconds of speech for `translatedText`. Null if unknowable. */
  estimatedDurationSeconds: number | null;
  /** The slot the dialogue gives this line. */
  sourceDurationSeconds: number;
  /** `estimated / source`, or null when there is nothing to compare. */
  durationRatio: number | null;
  durationWarning: TranslationDurationWarning;
  /** Which estimator produced the numbers above. */
  durationEstimatorVersion: string;
  /** Normalised 0–1, or null when the provider reports nothing comparable. */
  confidence: number | null;
  providerMetadata?: Record<string, unknown>;
}

/** Whether a person has rewritten this line's translation, and how often. */
export interface TranslationEditMetadata {
  manuallyEdited: boolean;
  /** Bumped once per persisted change to this line, not per keystroke. */
  revision: number;
  editedAt: string | null;
}

/**
 * One translated line.
 *
 * `id` is this record's own identity; `dialogueSegmentId` is the relationship
 * that matters — it is how every later stage joins a translation back to the
 * line it belongs to. Array position is never identity.
 *
 * `sourceText` is a snapshot of the dialogue text that was actually translated.
 * It is kept for auditability and for the fine-grained staleness detection a
 * later part can build: with the source text, speaker and timing recorded per
 * segment, it is possible to work out *which* lines changed rather than only
 * that the dialogue did.
 *
 * `translatedText` is the text Part 11 will speak. Once a person edits it,
 * `editMetadata.manuallyEdited` is true and their wording is authoritative —
 * nothing regenerates over it without them asking.
 */
export interface TranslatedDialogueSegment {
  id: string;
  /** The `DialogueSegment.id` this translates. Stable, never regenerated. */
  dialogueSegmentId: string;
  /** Copied from the dialogue. Translation never decides who is speaking. */
  speakerId: string | null;
  /** Copied from the dialogue. Translation never adjusts timing. */
  startTime: number;
  endTime: number;
  /** The dialogue text that was translated, as it stood at that revision. */
  sourceText: string;
  /** Empty only when the source segment was itself empty. */
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  /** Normalised 0–1, or null when the provider reports nothing comparable. */
  confidence: number | null;
  translationMetadata: DubbingTranslationMetadata;
  editMetadata: TranslationEditMetadata;
  providerMetadata?: Record<string, unknown>;
}

/**
 * A persisted translation of one dialogue revision into one target language.
 *
 * The identity that makes it *current* is the whole tuple of project, source
 * media, dialogue, dialogue revision and language pair — see
 * `TranslationIdentity`. Anything less would let a Polish translation of an
 * older cut show up as the current French translation of a newer one.
 */
export interface DialogueTranslation {
  id: string;
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  /** The exact `UnifiedDialogue.editMetadata.revision` that was translated. */
  dialogueRevision: number;
  sourceLanguage: string;
  targetLanguage: string;
  providerId: string;
  providerModel: string | null;
  /** Persisted schema version, bumped when the stored shape changes. */
  version: number;
  status: TranslationStatus;
  /** In dialogue timeline order, whatever order the provider answered in. */
  segments: TranslatedDialogueSegment[];
  createdAt: string;
  updatedAt: string;
  /**
   * Bumped by every persisted change to this translation — a manual edit, a
   * regenerated line, a shortened line. Segment-level operations carry the
   * revision they expect, so a slow request can never overwrite a newer edit.
   */
  revision: number;
  /** Provider-specific detail. Never read by the domain or the UI. */
  providerMetadata?: Record<string, unknown>;
  usage?: TranslationUsage | null;
}

/**
 * Everything that has to match for a stored translation to be the current one.
 *
 * Language pair is part of it (§75/§76): changing the project's target language
 * does not invalidate the old translation, it simply stops being the current
 * one — and switching back finds it again.
 */
export interface TranslationIdentity {
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  dialogueRevision: number;
  sourceLanguage: string;
  targetLanguage: string;
}

/**
 * One surrounding line, supplied so a provider can interpret the line it is
 * actually translating. Never something to translate in its own right.
 *
 * `existingTranslation` is what that neighbour currently reads as in the target
 * language, when there is one. It is what keeps a regenerated line consistent
 * with the conversation around it — the same name spelled the same way, the
 * same level of formality, a pronoun that agrees with the line before it.
 */
export interface TranslationContextSegment {
  segmentId: string;
  speakerId: string | null;
  /** Human-readable label for prompting only; `speakerId` stays canonical. */
  speakerName?: string | null;
  startTime: number;
  endTime: number;
  sourceText: string;
  existingTranslation?: string | null;
}

/**
 * The conversation around one line.
 *
 * Structured rather than a blob of prose: a provider has to be able to tell
 * which line is which, who said it, and in what order. Flattening it into a
 * paragraph is exactly how pronouns get misattributed.
 */
export interface TranslationSegmentContext {
  previousSegments: TranslationContextSegment[];
  nextSegments: TranslationContextSegment[];
  /**
   * Recent lines by this same speaker, when they fall outside the immediate
   * window. Helps keep one character's register consistent across a scene.
   */
  currentSpeakerRecentSegments?: TranslationContextSegment[];
  /**
   * Reserved. Aidub performs no scene analysis, so this stays null rather than
   * being filled with a summary nothing actually produced.
   */
  sceneSummary?: string | null;
}

/** One line handed to a provider. Structure it must preserve, not interpret. */
export interface TranslationRequestSegment {
  segmentId: string;
  /**
   * Passed for traceability and for speaker continuity. A provider may keep one
   * character's register consistent, but must never assign or change a speaker.
   */
  speakerId: string | null;
  /** Display name for prompting only; the id is what anything joins on. */
  speakerName?: string | null;
  /** Passed to preserve structure and enable later alignment. Never edited. */
  startTime: number;
  endTime: number;
  /** `endTime - startTime`: the slot this line has to be spoken in. */
  durationSeconds: number;
  sourceText: string;
  /** The line's current translation, for regeneration and shortening. */
  currentTranslation?: string | null;
  /** The conversation around this line. Guidance, never output. */
  context?: TranslationSegmentContext;
}

/**
 * What the translation should optimise for.
 *
 * Flags rather than free text so a provider that cannot honour one can ignore
 * it without having to parse an instruction — see
 * `TranslationProviderCapabilities.supportsDubbingConstraints`.
 */
export interface DubbingTranslationOptions {
  /** Keep register, humour, urgency and politeness as the source has them. */
  preserveTone: boolean;
  /** Write what a person would actually say, not a grammatical equivalent. */
  preferNaturalSpeech: boolean;
  /** Prefer phrasing that fits the line's slot, without losing meaning. */
  considerDuration: boolean;
}

/**
 * What a request is asking the provider to do.
 *
 * `full` translates a batch; `regenerate` produces a fresh translation for one
 * line already translated once; `shorter` asks for a more concise phrasing of
 * a line that is likely to overrun.
 */
export type TranslationOperation = "full" | "regenerate" | "shorter";

/**
 * A normalised translation request. Providers see only this — never a project
 * record, a dialogue document, or anything vendor-shaped.
 */
export interface TranslationRequest {
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  dialogueRevision: number;
  sourceLanguage: string;
  targetLanguage: string;
  /** The lines to translate. Everything else in the request is context. */
  segments: TranslationRequestSegment[];
  operation: TranslationOperation;
  options: DubbingTranslationOptions;
}

/** The defaults every Aidub translation runs with. */
export const DEFAULT_DUBBING_OPTIONS: DubbingTranslationOptions = {
  preserveTone: true,
  preferNaturalSpeech: true,
  considerDuration: true,
};

export function isTranslationStatus(value: unknown): value is TranslationStatus {
  return (
    typeof value === "string" &&
    (TRANSLATION_STATUSES as readonly string[]).includes(value)
  );
}

/** True when two identities describe the same current translation. */
export function sameTranslationIdentity(
  a: TranslationIdentity,
  b: TranslationIdentity,
): boolean {
  return (
    a.projectId === b.projectId &&
    a.sourceMediaId === b.sourceMediaId &&
    a.dialogueId === b.dialogueId &&
    a.dialogueRevision === b.dialogueRevision &&
    a.sourceLanguage === b.sourceLanguage &&
    a.targetLanguage === b.targetLanguage
  );
}

/** The identity a stored translation carries. */
export function translationIdentity(
  translation: DialogueTranslation,
): TranslationIdentity {
  return {
    projectId: translation.projectId,
    sourceMediaId: translation.sourceMediaId,
    dialogueId: translation.dialogueId,
    dialogueRevision: translation.dialogueRevision,
    sourceLanguage: translation.sourceLanguage,
    targetLanguage: translation.targetLanguage,
  };
}
