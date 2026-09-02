import { getLanguageLabel } from "@/lib/languages";
import type {
  TranslationContextSegment,
  TranslationRequest,
  TranslationUsage,
} from "@/types/translation";
import {
  TranslationError,
  errorCodeForHttpStatus,
  isRetryableTranslationError,
  translationError,
} from "@/server/translation/translation-errors";
import type {
  TranslationProvider,
  TranslationProviderCapabilities,
  TranslationProviderContext,
  TranslationProviderResult,
  TranslationProviderSegmentResult,
} from "@/server/translation/translation-provider";

/**
 * Translation through any OpenAI-compatible `POST /chat/completions` endpoint.
 *
 * That covers a wide range of very different runtimes behind one adapter —
 * OpenAI and Azure OpenAI, gateways such as OpenRouter, and self-hosted servers
 * that copy the shape (vLLM, Ollama, LM Studio, llama.cpp's server, TGI). It is
 * therefore both the hosted-API path and the self-hosted-model path; which one
 * is in use is a base-URL setting, not a code change.
 *
 * **Structured output, never prose.** Each line is sent as an object carrying
 * its stable dialogue segment id, and the model is required to answer with the
 * same ids. Nothing is ever recovered by splitting a paragraph or counting
 * lines: an id that does not come back is a failed job, not a guess.
 *
 * Credentials live only here, read from the server environment. They are never
 * sent to the browser, never stored in a translation, and never logged.
 *
 * Configuration:
 *   AIDUB_TRANSLATION_API_KEY   required
 *   AIDUB_TRANSLATION_BASE_URL  default https://api.openai.com/v1
 *   AIDUB_TRANSLATION_MODEL     default gpt-4o-mini
 *
 * From Part 10 the prompt is **dubbing-aware**: each line arrives with the
 * conversation around it, the speaker who says it and the duration it has to
 * fit, and the model is asked for natural spoken dialogue rather than a
 * grammatical equivalent. Three operations share one prompt shape — an initial
 * translation, a regeneration of one line, and a shorter phrasing of a line
 * that overruns — because they differ only in what is being asked for, not in
 * how the answer is structured.
 *
 * What it still does not do: change how many lines there are, move a timestamp,
 * decide a speaker, or compress meaning away to hit a duration. Duration is a
 * preference the model is told about, never a limit it must satisfy.
 */

export const OPENAI_COMPATIBLE_TRANSLATION_PROVIDER_ID = "openai-compatible";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
/** One extra attempt for transient failures; see `isRetryableTranslationError`. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 1_000;

export interface OpenAiCompatibleTranslationProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /** Overridable so tests do not wait on the transient-failure backoff. */
  delay?: (ms: number) => Promise<void>;
}

interface ChatCompletionResponse {
  choices?: unknown;
  usage?: unknown;
  model?: unknown;
  id?: unknown;
}

/** One background line, as structured data rather than interpolated prose. */
function toContextEntry(segment: TranslationContextSegment) {
  return {
    segmentId: segment.segmentId,
    speaker: segment.speakerName ?? segment.speakerId ?? "Unknown",
    text: segment.sourceText,
    ...(segment.existingTranslation
      ? { existingTranslation: segment.existingTranslation }
      : {}),
  };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

const SYSTEM_PROMPT = [
  "You are a professional dubbing translator working on spoken dialogue.",
  "Write what a person would actually say out loud in the target language, not a word-for-word rendering.",
  "Use contractions, natural word order, and idiomatic phrasing. Keep fragments as fragments and interruptions as interruptions.",
  "Use the surrounding lines only to interpret the line you are translating: resolve pronouns, references, questions and replies, and keep names, recurring terms and formality consistent with them.",
  "Keep each speaker's register consistent — formal stays formal, casual stays casual.",
  "Preserve meaning, intent and tone exactly as the source has them. Never add emotion, emphasis or detail that is not there.",
  "Preserve names, numbers and proper nouns.",
  "You never merge, split, reorder or drop lines, and you never translate a line you were not asked to translate.",
  "Do not add explanations, notes, transliterations or commentary.",
  'Reply with JSON only, as {"segments":[{"segmentId":"...","translatedText":"..."}]}.',
  "Return exactly one entry for every segmentId in the list you were asked to translate, using that same id, and no other ids.",
].join(" ");

/** What each operation asks for, on top of the shared rules above. */
const OPERATION_INSTRUCTIONS: Record<TranslationRequest["operation"], string> = {
  full: "Translate each line listed under \"translate\".",
  regenerate:
    'Translate the line listed under "translate" again. A previous translation is shown as "currentTranslation"; produce a better one that reads more naturally as spoken dialogue and fits the conversation around it. Do not simply repeat it.',
  shorter:
    'Rewrite the line listed under "translate" so it takes less time to say. A previous translation is shown as "currentTranslation". Keep the full meaning, intent and tone — drop filler and roundabout phrasing, never information. If it cannot be shortened without losing meaning, return the shortest faithful version you can.',
};

const DURATION_INSTRUCTION =
  'Each line has "availableSeconds", the time it has in the finished dub. Prefer phrasing that can reasonably be spoken in that time. This is a preference, not a limit: never remove essential meaning to satisfy it.';

export class OpenAiCompatibleTranslationProvider implements TranslationProvider {
  readonly id = OPENAI_COMPATIBLE_TRANSLATION_PROVIDER_ID;
  readonly displayName = "OpenAI-compatible translation API";
  readonly capabilities: TranslationProviderCapabilities = {
    supportsBatchTranslation: true,
    supportsContext: true,
    supportsDubbingConstraints: true,
    supportsStructuredOutput: true,
    supportsGlossary: false,
    // Chat completions expose no per-line translation confidence, and an
    // invented one would be worse than none.
    supportsConfidence: false,
    reportsUsage: true,
  };

  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(options: OpenAiCompatibleTranslationProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.AIDUB_TRANSLATION_API_KEY;
    this.baseUrl = (
      options.baseUrl ??
      process.env.AIDUB_TRANSLATION_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    this.model =
      options.model ?? process.env.AIDUB_TRANSLATION_MODEL ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.delay =
      options.delay ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey) && typeof this.fetchImpl === "function";
  }

  async translate(
    request: TranslationRequest,
    context: TranslationProviderContext = {},
  ): Promise<TranslationProviderResult> {
    if (!(await this.isAvailable())) {
      throw translationError("TRANSLATION_PROVIDER_UNAVAILABLE", {
        details: "AIDUB_TRANSLATION_API_KEY is not configured",
      });
    }

    // Checked before the request, not only around it: an already-cancelled job
    // must not spend a paid provider call on its way to being discarded.
    if (context.signal?.aborted) {
      throw translationError("TRANSLATION_CANCELLED");
    }

    context.onProgress?.({ percent: 10, stage: "Sending lines" });

    const payload = await this.callWithRetry(request, context);

    context.onProgress?.({ percent: 90, stage: "Reading translation" });

    return this.normalize(request, payload);
  }

  /**
   * One retry, and only for failures that could plausibly clear on their own.
   * A rejected key or an unsupported language fails immediately: repeating it
   * only burns quota and delays the message the user needs.
   */
  private async callWithRetry(
    request: TranslationRequest,
    context: TranslationProviderContext,
  ): Promise<ChatCompletionResponse> {
    let lastError: TranslationError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.call(request, context);
      } catch (cause) {
        if (
          !(cause instanceof TranslationError) ||
          !isRetryableTranslationError(cause.code) ||
          attempt === MAX_ATTEMPTS ||
          context.signal?.aborted
        ) {
          throw cause;
        }

        lastError = cause;
        await this.delay(RETRY_DELAY_MS);
      }
    }

    throw lastError ?? translationError("TRANSLATION_REQUEST_FAILED");
  }

  private async call(
    request: TranslationRequest,
    context: TranslationProviderContext,
  ): Promise<ChatCompletionResponse> {
    const body = {
      model: this.model,
      // Faithful translation, not creative writing.
      temperature: 0,
      response_format: { type: "json_object" as const },
      messages: [
        { role: "system" as const, content: SYSTEM_PROMPT },
        {
          role: "user" as const,
          content: this.userPrompt(request),
        },
      ],
    };

    let response: Response;

    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: context.signal,
      });
    } catch (cause) {
      if (context.signal?.aborted) {
        throw translationError("TRANSLATION_CANCELLED", { cause });
      }

      throw translationError("TRANSLATION_REQUEST_FAILED", { cause });
    }

    if (!response.ok) {
      throw translationError(errorCodeForHttpStatus(response.status), {
        details: `provider responded ${response.status}`,
      });
    }

    try {
      return (await response.json()) as ChatCompletionResponse;
    } catch (cause) {
      throw translationError("TRANSLATION_INVALID_RESPONSE", {
        details: "response was not JSON",
        cause,
      });
    }
  }

  /**
   * The request the model sees.
   *
   * Everything is structured JSON, including the speaker labels: a speaker name
   * is user-supplied text, and interpolating it into prose is how prompt
   * instructions end up inside a name. As a JSON string value it is data.
   *
   * The lines to translate and the lines that are only context sit in separate
   * keys so there is no ambiguity about which is which — the single most
   * important property of this prompt, since answering for a context line would
   * silently overwrite a neighbour's translation.
   */
  private userPrompt(request: TranslationRequest): string {
    const target = request.segments.map((segment) => ({
      segmentId: segment.segmentId,
      speaker: segment.speakerName ?? segment.speakerId ?? "Unknown",
      text: segment.sourceText,
      ...(request.options.considerDuration
        ? { availableSeconds: Math.round(segment.durationSeconds * 100) / 100 }
        : {}),
      ...(segment.currentTranslation
        ? { currentTranslation: segment.currentTranslation }
        : {}),
    }));

    // A batch shares one context; a single-line request carries its own.
    const context = request.segments[0]?.context;
    const before = context ? context.previousSegments.map(toContextEntry) : [];
    const after = context ? context.nextSegments.map(toContextEntry) : [];
    const speakerHistory = context?.currentSpeakerRecentSegments?.map(
      toContextEntry,
    );

    const payload = {
      sourceLanguage: `${getLanguageLabel(request.sourceLanguage)} (${request.sourceLanguage})`,
      targetLanguage: `${getLanguageLabel(request.targetLanguage)} (${request.targetLanguage})`,
      ...(before.length > 0 ? { contextBefore: before } : {}),
      translate: target,
      ...(after.length > 0 ? { contextAfter: after } : {}),
      ...(speakerHistory && speakerHistory.length > 0
        ? { sameSpeakerEarlier: speakerHistory }
        : {}),
    };

    return [
      OPERATION_INSTRUCTIONS[request.operation],
      request.options.considerDuration ? ` ${DURATION_INSTRUCTION}` : "",
      before.length > 0 || after.length > 0
        ? " Lines under contextBefore, contextAfter and sameSpeakerEarlier are background only — never return them."
        : "",
      "\nReturn one entry for every segmentId under \"translate\", and nothing else.\n\n",
      JSON.stringify(payload, null, 2),
    ].join("");
  }

  /** The one place that understands this vendor's JSON. */
  private normalize(
    request: TranslationRequest,
    payload: ChatCompletionResponse,
  ): TranslationProviderResult {
    const content = this.readContent(payload);
    let parsed: unknown;

    try {
      parsed = JSON.parse(content);
    } catch (cause) {
      throw translationError("TRANSLATION_INVALID_RESPONSE", {
        details: "model output was not JSON",
        cause,
      });
    }

    const rows = (parsed as { segments?: unknown } | null)?.segments;

    if (!Array.isArray(rows)) {
      throw translationError("TRANSLATION_INVALID_RESPONSE", {
        details: "segments missing from model output",
      });
    }

    const segments: TranslationProviderSegmentResult[] = rows.map((row) => {
      const record = (typeof row === "object" && row !== null ? row : {}) as {
        segmentId?: unknown;
        translatedText?: unknown;
      };

      // Shape only. Whether these ids match what was asked for is the
      // service's contract check, so one rule covers every provider.
      return {
        segmentId:
          typeof record.segmentId === "string" ? record.segmentId : "",
        translatedText:
          typeof record.translatedText === "string" ? record.translatedText : "",
        confidence: null,
        metadata: { model: this.model },
      };
    });

    return {
      sourceLanguage: request.sourceLanguage,
      targetLanguage: request.targetLanguage,
      segments,
      provider: {
        id: this.id,
        model: typeof payload.model === "string" ? payload.model : this.model,
        // A request id is useful for support tickets; nothing here is a secret.
        ...(typeof payload.id === "string"
          ? { metadata: { requestId: payload.id } }
          : {}),
      },
      usage: this.readUsage(payload),
    };
  }

  private readContent(payload: ChatCompletionResponse): string {
    const choice = Array.isArray(payload.choices)
      ? (payload.choices[0] as { message?: { content?: unknown } } | undefined)
      : undefined;
    const content = choice?.message?.content;

    if (typeof content !== "string" || content.trim().length === 0) {
      throw translationError("TRANSLATION_INVALID_RESPONSE", {
        details: "no message content in provider response",
      });
    }

    return content;
  }

  /** Usage is reported when the provider reports it, and null otherwise. */
  private readUsage(payload: ChatCompletionResponse): TranslationUsage | null {
    const usage = payload.usage as
      | { prompt_tokens?: unknown; completion_tokens?: unknown }
      | undefined;

    if (!usage) {
      return null;
    }

    const inputTokens = optionalNumber(usage.prompt_tokens);
    const outputTokens = optionalNumber(usage.completion_tokens);

    if (inputTokens === undefined && outputTokens === undefined) {
      return null;
    }

    return {
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      requestCount: 1,
    };
  }
}
