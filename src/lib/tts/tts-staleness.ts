import type { TranslatedDialogueSegment } from "@/types/translation";
import type {
  GeneratedSpeechSegment,
  SpeakerVoiceAssignment,
} from "@/types/tts";
import { fingerprintFor } from "@/lib/tts/generation-fingerprint";
import { hasSpeakableText, TTS_SCHEMA_VERSION } from "@/lib/tts/tts-config";

/**
 * Is this generated audio still what the project currently says?
 *
 * One place answers that, because the alternative is every component deciding
 * for itself and one of them eventually forgetting a case — and the failure
 * mode is silent: a dubbed line that plays confidently while speaking a
 * sentence the user rewrote, in the voice they replaced.
 *
 * Audio goes out of date when any of these changes:
 *
 * - the translated text or that line's edit revision (a manual edit, a
 *   regeneration, a shortening — all of Part 10's operations);
 * - the whole translation being replaced;
 * - the speaker the line is assigned to;
 * - the voice, or the settings, assigned to that speaker;
 * - the target language;
 * - the storage schema.
 *
 * Stale never means deleted. The audio stays stored and stays playable — it is
 * simply not what a later mix should use, and the workspace says so.
 */

export const GENERATED_SPEECH_STALE_REASONS = [
  "translation_changed",
  "segment_text_changed",
  "speaker_changed",
  "voice_changed",
  "settings_changed",
  "language_changed",
  "schema_changed",
  "no_audio",
  "generation_failed",
] as const;

export type GeneratedSpeechStaleReason =
  (typeof GENERATED_SPEECH_STALE_REASONS)[number];

export type GeneratedSpeechCurrency =
  | { current: true }
  | { current: false; reason: GeneratedSpeechStaleReason };

export interface CurrentTranslationContext {
  translationId: string;
  translationRevision: number;
  targetLanguage: string;
}

/**
 * The comparison, in full.
 *
 * `assignment` is the voice currently assigned to the line's *current* speaker.
 * Passing null means the speaker has no voice — which makes any existing audio
 * stale, because nothing currently says how that line should be spoken.
 */
export function generatedSpeechCurrency(
  generated: GeneratedSpeechSegment,
  segment: {
    dialogueSegmentId: string;
    speakerId: string | null;
    translatedText: string;
    editRevision: number;
  },
  translation: CurrentTranslationContext,
  assignment: SpeakerVoiceAssignment | null,
): GeneratedSpeechCurrency {
  if (generated.version !== TTS_SCHEMA_VERSION) {
    return { current: false, reason: "schema_changed" };
  }

  if (generated.targetLanguage !== translation.targetLanguage) {
    return { current: false, reason: "language_changed" };
  }

  if (generated.translationId !== translation.translationId) {
    return { current: false, reason: "translation_changed" };
  }

  if (generated.speakerId !== segment.speakerId) {
    // The line moved to another character: whatever was generated was spoken by
    // the wrong voice, however unchanged the words are.
    return { current: false, reason: "speaker_changed" };
  }

  // A line with nothing to say is current when it was recorded as such.
  //
  // This asks `hasSpeakableText`, the same predicate the generation service
  // uses to decide not to call a provider. Two different definitions of "empty"
  // here — whitespace-only in one place, letters-and-digits in the other —
  // would leave a punctuation-only line recorded as silent and judged stale
  // forever: regenerated on every run, never settling.
  if (!hasSpeakableText(segment.translatedText)) {
    return generated.status === "skipped_empty"
      ? { current: true }
      : { current: false, reason: "segment_text_changed" };
  }

  if (generated.status === "failed") {
    return { current: false, reason: "generation_failed" };
  }

  if (!assignment) {
    return { current: false, reason: "voice_changed" };
  }

  if (generated.status !== "completed" || !generated.artifactId) {
    return { current: false, reason: "no_audio" };
  }

  const expected = fingerprintFor(segment, segment.speakerId, assignment);

  if (expected === generated.fingerprint) {
    return { current: true };
  }

  // The fingerprint says something changed; these comparisons say what, so the
  // workspace can explain it rather than just claiming "outdated".
  if (generated.translatedSegmentRevision !== segment.editRevision) {
    return { current: false, reason: "segment_text_changed" };
  }

  if (generated.voiceId !== assignment.voice.voiceId) {
    return { current: false, reason: "voice_changed" };
  }

  if (generated.providerId !== assignment.voice.providerId) {
    return { current: false, reason: "voice_changed" };
  }

  if (!sameSettings(generated.generationSettings, assignment.settings)) {
    return { current: false, reason: "settings_changed" };
  }

  // Same revision, same voice, same settings, different fingerprint: the text
  // itself was replaced without the revision moving.
  return { current: false, reason: "segment_text_changed" };
}

export function isGeneratedSpeechCurrent(
  generated: GeneratedSpeechSegment,
  segment: {
    dialogueSegmentId: string;
    speakerId: string | null;
    translatedText: string;
    editRevision: number;
  },
  translation: CurrentTranslationContext,
  assignment: SpeakerVoiceAssignment | null,
): boolean {
  return generatedSpeechCurrency(generated, segment, translation, assignment)
    .current;
}

function sameSettings(
  a: SpeakerVoiceAssignment["settings"],
  b: SpeakerVoiceAssignment["settings"],
): boolean {
  return (
    (a.speakingRate ?? null) === (b.speakingRate ?? null) &&
    (a.pitch ?? null) === (b.pitch ?? null) &&
    (a.volumeGain ?? null) === (b.volumeGain ?? null) &&
    (a.style ?? null) === (b.style ?? null)
  );
}

/** What a translated segment looks like to the staleness check. */
export function toStalenessSegment(segment: TranslatedDialogueSegment): {
  dialogueSegmentId: string;
  speakerId: string | null;
  translatedText: string;
  editRevision: number;
} {
  return {
    dialogueSegmentId: segment.dialogueSegmentId,
    speakerId: segment.speakerId,
    translatedText: segment.translatedText,
    editRevision: segment.editMetadata.revision,
  };
}

/** Plain wording for the workspace; never a code shown to a person. */
export const GENERATED_SPEECH_STALE_MESSAGES: Record<
  GeneratedSpeechStaleReason,
  string
> = {
  translation_changed: "The translation was replaced since this was generated.",
  segment_text_changed: "The translated line changed since this was generated.",
  speaker_changed: "This line was reassigned to a different speaker.",
  voice_changed: "This speaker's voice changed since this was generated.",
  settings_changed: "This speaker's voice settings changed.",
  language_changed: "The target language changed.",
  schema_changed: "This audio was stored in an older format.",
  no_audio: "No audio was stored for this line.",
  generation_failed: "The last attempt to generate this line failed.",
};
