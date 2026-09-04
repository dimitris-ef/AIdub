import {
  DEFAULT_TTS_SETTINGS,
  type SpeakerVoiceAssignment,
  type TtsGenerationSettings,
  type VoiceSource,
} from "@/types/tts";

/**
 * Speaker→voice assignment persistence.
 *
 * Assignments are a small, long-lived, human-authored record: someone listened
 * to voices and cast a scene. That makes them the most valuable thing Part 11
 * stores and the one thing it must never lose or silently rewrite — audio can
 * always be generated again, a casting decision cannot.
 *
 * Keyed by the **stable** `speakerId`, so renaming a speaker in the Transcript
 * editor changes nothing here. Language is part of the record rather than the
 * key: a project dubbed into two languages needs a voice per language, and
 * having the field already means that arrives without a migration.
 */
export interface VoiceAssignmentIdentity {
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  targetLanguage: string;
}

export interface VoiceAssignmentRepository {
  /** Every assignment for one dialogue and language. */
  listByIdentity(
    identity: VoiceAssignmentIdentity,
  ): Promise<SpeakerVoiceAssignment[]>;
  getBySpeaker(
    identity: VoiceAssignmentIdentity,
    speakerId: string,
  ): Promise<SpeakerVoiceAssignment | null>;
  save(assignment: SpeakerVoiceAssignment): Promise<SpeakerVoiceAssignment>;
  delete(
    identity: VoiceAssignmentIdentity,
    speakerId: string,
  ): Promise<void>;
  deleteByMedia(projectId: string, sourceMediaId: string): Promise<void>;
  deleteByProject(projectId: string): Promise<void>;
}

export class VoiceAssignmentStorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "VoiceAssignmentStorageError";
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSettings(value: unknown): TtsGenerationSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_TTS_SETTINGS };
  }

  const record = value as Record<string, unknown>;

  return {
    speakingRate: finiteNumber(record.speakingRate) ? record.speakingRate : null,
    pitch: finiteNumber(record.pitch) ? record.pitch : null,
    volumeGain: finiteNumber(record.volumeGain) ? record.volumeGain : null,
    style: isNonEmptyString(record.style) ? record.style : null,
  };
}

/**
 * A stored voice source.
 *
 * The discriminant is checked rather than assumed: when Part 12 adds cloned
 * voices, a record written by a newer build must be rejected here rather than
 * loaded as a standard voice and quietly spoken in the wrong one.
 */
function parseVoice(value: unknown): VoiceSource | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    record.type !== "standard" ||
    !isNonEmptyString(record.providerId) ||
    !isNonEmptyString(record.voiceId)
  ) {
    return null;
  }

  return {
    type: "standard",
    providerId: record.providerId,
    voiceId: record.voiceId,
  };
}

/**
 * Validates a stored assignment before it re-enters the application.
 *
 * Unlike a transcript or a translation, an unreadable assignment cannot be
 * regenerated — nothing can reconstruct which voice a person picked. So it is
 * skipped, never guessed at and never replaced with a default: the workspace
 * shows the speaker as unassigned and asks, which is honest.
 */
export function parseStoredVoiceAssignment(
  value: unknown,
): SpeakerVoiceAssignment | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const voice = parseVoice(record.voice);

  if (
    !voice ||
    !isNonEmptyString(record.id) ||
    !isNonEmptyString(record.projectId) ||
    !isNonEmptyString(record.sourceMediaId) ||
    !isNonEmptyString(record.dialogueId) ||
    !isNonEmptyString(record.speakerId) ||
    !isNonEmptyString(record.targetLanguage)
  ) {
    return null;
  }

  return {
    id: record.id,
    projectId: record.projectId,
    sourceMediaId: record.sourceMediaId,
    dialogueId: record.dialogueId,
    speakerId: record.speakerId,
    voice,
    targetLanguage: record.targetLanguage,
    settings: parseSettings(record.settings),
    createdAt: isNonEmptyString(record.createdAt) ? record.createdAt : "",
    updatedAt: isNonEmptyString(record.updatedAt) ? record.updatedAt : "",
  };
}

export function matchesVoiceIdentity(
  assignment: SpeakerVoiceAssignment,
  identity: VoiceAssignmentIdentity,
): boolean {
  return (
    assignment.projectId === identity.projectId &&
    assignment.sourceMediaId === identity.sourceMediaId &&
    assignment.dialogueId === identity.dialogueId &&
    assignment.targetLanguage === identity.targetLanguage
  );
}

/**
 * A deterministic record id.
 *
 * One speaker in one dialogue and language has exactly one assignment, so the
 * id is derived from that tuple rather than minted: saving twice replaces the
 * record instead of accumulating rival assignments whose winner depends on
 * timestamps.
 */
export function voiceAssignmentId(
  identity: VoiceAssignmentIdentity,
  speakerId: string,
): string {
  return [
    identity.dialogueId,
    identity.targetLanguage,
    speakerId,
  ]
    .map((part) => part.replace(/[^A-Za-z0-9._-]/g, "_"))
    .join("__");
}
