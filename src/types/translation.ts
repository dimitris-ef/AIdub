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

/** One line handed to a provider. Structure it must preserve, not interpret. */
export interface TranslationRequestSegment {
  segmentId: string;
  /**
   * Passed for traceability and for future speaker-aware translation. Part 9
   * providers must not vary style by speaker, and must never assign one.
   */
  speakerId: string | null;
  /** Passed to preserve structure and enable later alignment. Never edited. */
  startTime: number;
  endTime: number;
  sourceText: string;
}

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
  segments: TranslationRequestSegment[];
}

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
