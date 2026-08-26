import { readFile } from "node:fs/promises";

import {
  errorCodeForHttpStatus,
  transcriptionError,
} from "@/server/transcription/transcription-errors";
import type {
  SpeechToTextContext,
  SpeechToTextInput,
  SpeechToTextProvider,
  SpeechToTextProviderCapabilities,
  SpeechToTextResult,
  SpeechToTextSegmentResult,
} from "@/server/transcription/speech-to-text-provider";

/**
 * Remote speech-to-text over the widely implemented
 * `POST /audio/transcriptions` shape (OpenAI's Whisper endpoint and the
 * self-hosted servers that copy it, such as faster-whisper-server or
 * whisper.cpp's server).
 *
 * Credentials live only here, read from the server environment: they are never
 * sent to the browser, never stored in a transcript, and never logged.
 *
 * Configuration:
 *   AIDUB_STT_API_KEY   required
 *   AIDUB_STT_BASE_URL  default https://api.openai.com/v1
 *   AIDUB_STT_MODEL     default whisper-1
 */

export const OPENAI_COMPATIBLE_PROVIDER_ID = "openai-compatible";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "whisper-1";

export interface OpenAiCompatibleProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface VerboseJsonResponse {
  language?: unknown;
  text?: unknown;
  segments?: unknown;
}

interface VerboseJsonSegment {
  start?: unknown;
  end?: unknown;
  text?: unknown;
  avg_logprob?: unknown;
  no_speech_prob?: unknown;
  compression_ratio?: unknown;
  temperature?: unknown;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export class OpenAiCompatibleSpeechToTextProvider
  implements SpeechToTextProvider
{
  readonly id = OPENAI_COMPATIBLE_PROVIDER_ID;
  readonly displayName = "OpenAI-compatible transcription API";
  readonly capabilities: SpeechToTextProviderCapabilities = {
    supportsLanguageHint: true,
    supportsSegmentTimestamps: true,
    supportsWordTimestamps: false,
    // The endpoint reports log probabilities, not a 0–1 confidence.
    reportsConfidence: false,
  };

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAiCompatibleProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.AIDUB_STT_API_KEY;
    this.baseUrl = (
      options.baseUrl ??
      process.env.AIDUB_STT_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.model = options.model ?? process.env.AIDUB_STT_MODEL ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey) && typeof this.fetchImpl === "function";
  }

  async transcribe(
    input: SpeechToTextInput,
    context: SpeechToTextContext = {},
  ): Promise<SpeechToTextResult> {
    if (!(await this.isAvailable())) {
      throw transcriptionError("STT_PROVIDER_UNAVAILABLE", {
        details: "AIDUB_STT_API_KEY is not configured",
      });
    }

    const bytes = await this.readAudio(input);

    context.onProgress?.({ percent: 20, stage: "Uploading audio" });

    const form = new FormData();
    form.set("file", new Blob([bytes as BlobPart], { type: input.audio.mimeType }), "audio.wav");
    form.set("model", this.model);
    form.set("response_format", "verbose_json");
    form.set("timestamp_granularities[]", "segment");

    if (input.language) {
      form.set("language", input.language);
    }

    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: context.signal,
      });
    } catch (cause) {
      if (context.signal?.aborted) {
        throw transcriptionError("TRANSCRIPTION_CANCELLED", { cause });
      }

      throw transcriptionError("STT_REQUEST_FAILED", { cause });
    }

    if (!response.ok) {
      throw transcriptionError(errorCodeForHttpStatus(response.status), {
        details: `provider responded ${response.status}`,
      });
    }

    context.onProgress?.({ percent: 80, stage: "Reading transcription" });

    let payload: VerboseJsonResponse;

    try {
      payload = (await response.json()) as VerboseJsonResponse;
    } catch (cause) {
      throw transcriptionError("STT_INVALID_RESPONSE", {
        details: "response was not JSON",
        cause,
      });
    }

    return this.normalize(payload);
  }

  private async readAudio(input: SpeechToTextInput): Promise<Uint8Array> {
    if (input.audio.bytes) {
      return input.audio.bytes;
    }

    if (input.audio.path) {
      try {
        return new Uint8Array(await readFile(input.audio.path));
      } catch (cause) {
        throw transcriptionError("AUDIO_ARTIFACT_MISSING", { cause });
      }
    }

    throw transcriptionError("AUDIO_ARTIFACT_MISSING", {
      details: "no audio supplied",
    });
  }

  /** The one place that understands this vendor's JSON. */
  private normalize(payload: VerboseJsonResponse): SpeechToTextResult {
    if (!Array.isArray(payload.segments)) {
      // A response without segments is only acceptable when it also carries no
      // text — anything else means the shape is not what we asked for.
      if (typeof payload.text === "string" && payload.text.trim().length === 0) {
        return {
          language:
            typeof payload.language === "string" ? payload.language : null,
          segments: [],
          provider: { id: this.id, model: this.model },
        };
      }

      throw transcriptionError("STT_INVALID_RESPONSE", {
        details: "segments missing from provider response",
      });
    }

    const segments: SpeechToTextSegmentResult[] = (
      payload.segments as VerboseJsonSegment[]
    ).map((segment) => {
      const metadata: Record<string, unknown> = { model: this.model };
      const averageLogProb = optionalNumber(segment.avg_logprob);
      const noSpeechProb = optionalNumber(segment.no_speech_prob);

      if (averageLogProb !== null) {
        metadata.averageLogProbability = averageLogProb;
      }
      if (noSpeechProb !== null) {
        metadata.noSpeechProbability = noSpeechProb;
      }

      return {
        startTime: optionalNumber(segment.start) ?? Number.NaN,
        endTime: optionalNumber(segment.end) ?? Number.NaN,
        text: typeof segment.text === "string" ? segment.text : "",
        confidence: null,
        metadata,
      };
    });

    return {
      language: typeof payload.language === "string" ? payload.language : null,
      segments,
      provider: { id: this.id, model: this.model },
    };
  }
}
