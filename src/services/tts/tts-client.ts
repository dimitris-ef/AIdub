import type {
  GeneratedSpeechSegment,
  SpeakerVoiceAssignment,
  TtsGenerationSettings,
  TtsVoice,
} from "@/types/tts";
import type { GeneratedSpeechStaleReason } from "@/lib/tts/tts-staleness";

/**
 * The frontend's view of speech generation.
 *
 * Components ask "which voices can this server speak Polish with?", "who is
 * cast as whom?" and "is this line's audio still right?" and get answers. They
 * never learn which provider is configured, whether it runs locally or against
 * a hosted API, what a call costs, or where any audio file lives.
 *
 * Starting a generation run is deliberately *not* here: that goes through the
 * shared `ProcessingClient`, because speech generation is a processing job like
 * any other and Part 11 adds no second job system. This client reads back what
 * that job persisted, and writes the one thing that is not a job — a person's
 * casting decision.
 */

export const SPEECH_STATES = [
  "ready",
  "partial",
  "not_generated",
  "voices_required",
  "translation_required",
  "translation_stale",
] as const;

export type SpeechState = (typeof SPEECH_STATES)[number];

export interface SpeechSegmentView {
  dialogueSegmentId: string;
  speakerId: string | null;
  translatedText: string;
  startTime: number;
  endTime: number;
  segmentDurationSeconds: number;
  generated: GeneratedSpeechSegment | null;
  current: boolean;
  staleReason?: GeneratedSpeechStaleReason;
}

export interface SpeechResponse {
  state: SpeechState;
  targetLanguage: string;
  translationId: string | null;
  translationRevision: number | null;
  dialogueId: string | null;
  segments: SpeechSegmentView[];
  assignments: SpeakerVoiceAssignment[];
  unassignedSpeakerIds: string[];
  hasUnassignedSegments: boolean;
  currentCount: number;
  staleCount: number;
  details?: string;
}

export interface VoiceCatalogResponse {
  providerId: string;
  /** False when the provider is not configured on this server. */
  available: boolean;
  voices: TtsVoice[];
}

export interface VoiceAssignmentTarget {
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  targetLanguage: string;
}

export class TtsRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TtsRequestError";
  }
}

export interface TtsClient {
  getVoices(
    targetLanguage: string,
    providerId?: string | null,
  ): Promise<VoiceCatalogResponse>;
  getSpeech(
    projectId: string,
    sourceMediaId: string,
    targetLanguage: string,
  ): Promise<SpeechResponse>;
  assignVoice(
    target: VoiceAssignmentTarget,
    speakerId: string,
    voice: { providerId: string; voiceId: string },
    settings?: TtsGenerationSettings,
  ): Promise<SpeakerVoiceAssignment>;
  removeAssignment(
    target: VoiceAssignmentTarget,
    speakerId: string,
  ): Promise<void>;
  /**
   * The URL that plays one generated line.
   *
   * A URL rather than bytes: an `<audio>` element streams it, seeks in it and
   * lets the browser manage its memory — none of which is true of a blob the
   * page has to hold and remember to revoke.
   */
  audioUrl(projectId: string, generatedId: string): string;
  /** Bytes for a voice audition, which is not part of any project. */
  previewVoice(
    voice: { providerId: string; voiceId: string },
    targetLanguage: string,
    signal?: AbortSignal,
  ): Promise<Blob>;
}

function target(parameters: VoiceAssignmentTarget): URLSearchParams {
  return new URLSearchParams({
    projectId: parameters.projectId,
    mediaId: parameters.sourceMediaId,
    dialogueId: parameters.dialogueId,
    targetLanguage: parameters.targetLanguage,
  });
}

async function readError(response: Response, fallback: string): Promise<never> {
  let code = "INTERNAL_ERROR";
  let message = fallback;

  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string };
    };

    code = body.error?.code ?? code;
    message = body.error?.message ?? message;
  } catch {
    // A non-JSON error body is a server problem, not something to surface raw.
  }

  throw new TtsRequestError(code, message);
}

export const ttsClient: TtsClient = {
  async getVoices(targetLanguage, providerId) {
    const parameters = new URLSearchParams({ targetLanguage });

    if (providerId) {
      parameters.set("providerId", providerId);
    }

    const response = await fetch(`/api/tts/voices?${parameters}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return readError(response, "The available voices could not be loaded.");
    }

    return (await response.json()) as VoiceCatalogResponse;
  },

  async getSpeech(projectId, sourceMediaId, targetLanguage) {
    const parameters = new URLSearchParams({
      projectId,
      mediaId: sourceMediaId,
      targetLanguage,
    });
    const response = await fetch(`/api/tts/speech?${parameters}`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return readError(response, "The generated speech could not be loaded.");
    }

    return (await response.json()) as SpeechResponse;
  },

  async assignVoice(assignTo, speakerId, voice, settings) {
    const response = await fetch(`/api/tts/assignments?${target(assignTo)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speakerId, ...voice, settings }),
    });

    if (!response.ok) {
      return readError(response, "The voice could not be assigned.");
    }

    const body = (await response.json()) as {
      assignment: SpeakerVoiceAssignment;
    };

    return body.assignment;
  },

  async removeAssignment(assignTo, speakerId) {
    const parameters = target(assignTo);
    parameters.set("speakerId", speakerId);

    const response = await fetch(`/api/tts/assignments?${parameters}`, {
      method: "DELETE",
    });

    if (!response.ok) {
      await readError(response, "The voice assignment could not be removed.");
    }
  },

  audioUrl(projectId, generatedId) {
    const parameters = new URLSearchParams({ projectId });

    return `/api/tts/speech/${encodeURIComponent(generatedId)}/audio?${parameters}`;
  },

  async previewVoice(voice, targetLanguage, signal) {
    const response = await fetch("/api/tts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...voice, targetLanguage }),
      signal,
    });

    if (!response.ok) {
      return readError(response, "The voice could not be previewed.");
    }

    return response.blob();
  },
};
