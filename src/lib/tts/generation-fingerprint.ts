import type {
  SpeakerVoiceAssignment,
  TtsGenerationSettings,
  VoiceSource,
} from "@/types/tts";

/**
 * Everything that would change the audio, folded into one string.
 *
 * Generated speech goes out of date for many reasons — the line was rewritten,
 * its speaker changed, the voice changed, a setting changed, the language
 * changed. Comparing each of those at every call site would mean five places to
 * forget one. Instead the inputs are hashed once at generation time and
 * compared as a whole, so "is this audio still right?" is one equality check.
 *
 * This is an **identity** mechanism, not a security one. It exists to notice
 * change, not to resist tampering; a collision would cost a stale line, not a
 * vulnerability. It is deliberately readable rather than cryptographic so a
 * mismatch can be understood by looking at it.
 */

/** Bumped when the recipe changes, so old fingerprints compare as different. */
export const FINGERPRINT_VERSION = "v1";

function normalizeSettings(settings: TtsGenerationSettings): string {
  // Fixed key order, and an explicit marker for "unset" — a provider default is
  // a different configuration from an explicit value that happens to match it.
  return [
    settings.speakingRate ?? "-",
    settings.pitch ?? "-",
    settings.volumeGain ?? "-",
    settings.style ?? "-",
  ].join(",");
}

export interface FingerprintInput {
  dialogueSegmentId: string;
  translatedSegmentRevision: number;
  translatedText: string;
  speakerId: string | null;
  targetLanguage: string;
  voice: VoiceSource;
  settings: TtsGenerationSettings;
}

/**
 * The fingerprint for one line's current configuration.
 *
 * The translated *text* is included as well as its revision: a revision proves
 * a change happened, but the text proves what was actually spoken, which is
 * what makes a fingerprint comparison meaningful after a migration or a
 * regenerated translation that landed on the same revision number.
 */
export function generationFingerprint(input: FingerprintInput): string {
  const parts = [
    FINGERPRINT_VERSION,
    input.dialogueSegmentId,
    String(input.translatedSegmentRevision),
    input.speakerId ?? "unassigned",
    input.targetLanguage,
    input.voice.type,
    input.voice.providerId,
    input.voice.voiceId,
    normalizeSettings(input.settings),
    hashText(input.translatedText),
  ];

  return parts.join("|");
}

/**
 * A short, stable digest of the spoken text.
 *
 * FNV-1a: tiny, dependency-free, and deterministic across processes. The text
 * itself is not stored in the fingerprint because a fingerprint is compared and
 * logged, and dialogue text should not end up in either.
 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // 32-bit FNV prime multiply, kept in range without BigInt.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return `${text.length.toString(36)}.${hash.toString(36)}`;
}

/** The fingerprint an assignment and a translated line would produce now. */
export function fingerprintFor(
  segment: {
    dialogueSegmentId: string;
    translatedText: string;
    editRevision: number;
  },
  speakerId: string | null,
  assignment: Pick<
    SpeakerVoiceAssignment,
    "voice" | "settings" | "targetLanguage"
  >,
): string {
  return generationFingerprint({
    dialogueSegmentId: segment.dialogueSegmentId,
    translatedSegmentRevision: segment.editRevision,
    translatedText: segment.translatedText,
    speakerId,
    targetLanguage: assignment.targetLanguage,
    voice: assignment.voice,
    settings: assignment.settings,
  });
}
