import type { UnifiedDialogue } from "@/types/dialogue";
import type { DialogueTranslation } from "@/types/translation";
import { TRANSLATION_SCHEMA_VERSION } from "@/lib/translation/translation-config";

/**
 * A translation is only valid for the exact thing it translated.
 *
 * That is the whole tuple: this project, this source media version, this
 * dialogue, **this dialogue revision**, and this language pair. Change any of
 * them and the stored translation describes text that no longer exists.
 *
 * The revision is the important one. Part 8 bumps it on every persisted
 * correction — a rewritten line, a reassigned speaker, a retimed segment, a
 * split or a merge — so a single edit anywhere in the dialogue makes the whole
 * translation stale. That is coarse on purpose: Part 9 stores the source text,
 * speaker and timing of every translated line precisely so a later part can
 * work out *which* lines actually changed and retranslate only those. Guessing
 * at partial validity now, before that data has been used in anger, would risk
 * presenting text that was translated from a sentence the user has since
 * rewritten.
 *
 * Stale never means deleted. The translation stays stored and stays findable —
 * switching the target language back, or undoing a dialogue edit, finds it
 * again — it simply stops being presented as current.
 */

export const TRANSLATION_STALE_REASONS = [
  "project_mismatch",
  "source_mismatch",
  "dialogue_changed",
  "dialogue_revision_changed",
  "source_language_changed",
  "target_language_changed",
  "schema_changed",
] as const;

export type TranslationStaleReason = (typeof TRANSLATION_STALE_REASONS)[number];

export type TranslationCurrency =
  | { current: true }
  | { current: false; reason: TranslationStaleReason };

export interface TranslationTarget {
  sourceLanguage: string;
  targetLanguage: string;
}

export function translationCurrency(
  translation: DialogueTranslation,
  dialogue: UnifiedDialogue,
  languages: TranslationTarget,
): TranslationCurrency {
  if (translation.projectId !== dialogue.projectId) {
    return { current: false, reason: "project_mismatch" };
  }

  if (translation.sourceMediaId !== dialogue.sourceMediaId) {
    return { current: false, reason: "source_mismatch" };
  }

  if (translation.dialogueId !== dialogue.id) {
    return { current: false, reason: "dialogue_changed" };
  }

  if (translation.dialogueRevision !== dialogue.editMetadata.revision) {
    return { current: false, reason: "dialogue_revision_changed" };
  }

  if (translation.sourceLanguage !== languages.sourceLanguage) {
    return { current: false, reason: "source_language_changed" };
  }

  if (translation.targetLanguage !== languages.targetLanguage) {
    return { current: false, reason: "target_language_changed" };
  }

  if (translation.version !== TRANSLATION_SCHEMA_VERSION) {
    return { current: false, reason: "schema_changed" };
  }

  return { current: true };
}

export function isTranslationCurrent(
  translation: DialogueTranslation,
  dialogue: UnifiedDialogue,
  languages: TranslationTarget,
): boolean {
  return translationCurrency(translation, dialogue, languages).current;
}

/** Plain wording for the workspace; never a code shown to a person. */
export const TRANSLATION_STALE_MESSAGES: Record<
  TranslationStaleReason,
  string
> = {
  project_mismatch: "This translation belongs to a different project.",
  source_mismatch: "This translation belongs to an earlier source video.",
  dialogue_changed: "The dialogue was rebuilt since this translation was made.",
  dialogue_revision_changed:
    "The dialogue has changed since this translation was created.",
  source_language_changed:
    "The project's source language changed since this translation was created.",
  target_language_changed:
    "The project's target language changed since this translation was created.",
  schema_changed: "This translation was stored in an older format.",
};
