import type { NextRequest } from "next/server";

import { isLanguageCode } from "@/lib/languages";
import { TtsError } from "@/server/tts/tts-errors";
import { ttsGenerationService } from "@/server/processing";
import { errorResponse } from "@/app/api/processing/_shared";

/**
 * Which voice speaks for each speaker.
 *
 * Unlike generated audio, an assignment is not produced by a job: it is a
 * person's decision, it is instant, and it costs nothing. So it is written
 * directly here rather than through the processing pipeline — but still
 * server-side, because the voice is validated against the provider's catalog
 * and the target language before it is stored, and because a provider's
 * credentials must never be reachable from a browser.
 *
 * Every route on this path names the project, source media, dialogue and
 * language explicitly: an assignment belongs to exactly one of each, and
 * inferring any of them would be how one project's casting reaches another's.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Identity {
  projectId: string;
  sourceMediaId: string;
  dialogueId: string;
  targetLanguage: string;
}

function readIdentity(request: NextRequest): Identity | null {
  const parameters = request.nextUrl.searchParams;
  const projectId = parameters.get("projectId");
  const sourceMediaId = parameters.get("mediaId");
  const dialogueId = parameters.get("dialogueId");
  const targetLanguage = parameters.get("targetLanguage");

  if (
    !projectId ||
    !sourceMediaId ||
    !dialogueId ||
    !isLanguageCode(targetLanguage)
  ) {
    return null;
  }

  return { projectId, sourceMediaId, dialogueId, targetLanguage };
}

/** Maps a TTS failure onto a status a browser can act on. */
function statusFor(code: string): number {
  if (code === "TTS_VOICE_NOT_FOUND") return 404;
  if (code === "TTS_PROVIDER_UNAVAILABLE") return 503;

  return 400;
}

export async function GET(request: NextRequest) {
  const identity = readIdentity(request);

  if (!identity) {
    return errorResponse(
      "INVALID_REQUEST",
      "A project, source media, dialogue and target language are required.",
      400,
    );
  }

  try {
    return Response.json({
      assignments: await ttsGenerationService.listAssignments(identity),
    });
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The voice assignments could not be loaded.",
      500,
    );
  }
}

export async function PUT(request: NextRequest) {
  const identity = readIdentity(request);

  if (!identity) {
    return errorResponse(
      "INVALID_REQUEST",
      "A project, source media, dialogue and target language are required.",
      400,
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse(
      "INVALID_REQUEST",
      "The assignment could not be read.",
      400,
    );
  }

  const record = (typeof body === "object" && body !== null ? body : {}) as {
    speakerId?: unknown;
    providerId?: unknown;
    voiceId?: unknown;
    settings?: unknown;
  };

  if (
    typeof record.speakerId !== "string" ||
    record.speakerId.trim().length === 0 ||
    typeof record.providerId !== "string" ||
    record.providerId.trim().length === 0 ||
    typeof record.voiceId !== "string" ||
    record.voiceId.trim().length === 0
  ) {
    return errorResponse(
      "INVALID_REQUEST",
      "A speaker and a voice are required.",
      400,
    );
  }

  try {
    const assignment = await ttsGenerationService.assignVoice(
      identity,
      record.speakerId,
      {
        // Part 11 assigns published voices only. A cloned voice is a Part 12
        // variant of this union, and until it exists nothing may claim to be
        // one.
        type: "standard",
        providerId: record.providerId,
        voiceId: record.voiceId,
      },
      readSettings(record.settings),
    );

    return Response.json({ assignment });
  } catch (cause) {
    if (cause instanceof TtsError) {
      return errorResponse(cause.code, cause.message, statusFor(cause.code));
    }

    return errorResponse(
      "INTERNAL_ERROR",
      "The voice could not be assigned.",
      500,
    );
  }
}

export async function DELETE(request: NextRequest) {
  const identity = readIdentity(request);
  const speakerId = request.nextUrl.searchParams.get("speakerId");

  if (!identity || !speakerId) {
    return errorResponse(
      "INVALID_REQUEST",
      "A project, source media, dialogue, target language and speaker are required.",
      400,
    );
  }

  try {
    await ttsGenerationService.removeAssignment(identity, speakerId);

    return Response.json({ ok: true });
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "The voice assignment could not be removed.",
      500,
    );
  }
}

/**
 * Only the settings Part 11 defines, and only when they are numbers.
 *
 * Anything else is dropped rather than passed through: a stored setting shapes
 * every future provider call, and an unrecognised key would be a browser
 * writing into a request payload it does not own.
 */
function readSettings(value: unknown) {
  const record = (typeof value === "object" && value !== null ? value : {}) as {
    speakingRate?: unknown;
    pitch?: unknown;
    volumeGain?: unknown;
    style?: unknown;
  };
  const number = (input: unknown) =>
    typeof input === "number" && Number.isFinite(input) ? input : null;

  return {
    speakingRate: number(record.speakingRate),
    pitch: number(record.pitch),
    volumeGain: number(record.volumeGain),
    style: typeof record.style === "string" ? record.style : null,
  };
}
