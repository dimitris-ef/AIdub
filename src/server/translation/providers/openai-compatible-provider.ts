import { getLanguageLabel } from "@/lib/languages";
import type { TranslationRequest, TranslationUsage } from "@/types/translation";
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
 * Part 9 scope: faithful, segment-preserving translation. The prompt asks for
 * accuracy and natural target-language phrasing and nothing else — no
 * shortening to fit a take, no lip-sync phrasing, no scene context, no
 * character voice. Those belong to Part 10 and would change the meaning of the
 * text this layer is supposed to preserve.
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

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

const SYSTEM_PROMPT = [
  "You are a professional subtitle translator.",
  "You translate one line of dialogue at a time and you never merge, split, reorder or drop lines.",
  "Translate the meaning faithfully and write natural, idiomatic target-language text.",
  "Preserve names, numbers and proper nouns. Keep the register and tone of the original.",
  "Do not add explanations, notes, transliterations or commentary.",
  "Do not shorten or expand a line to fit any duration.",
  'Reply with JSON only, as {"segments":[{"segmentId":"...","translatedText":"..."}]}.',
  "Return exactly one entry for every segmentId you were given, using that same id.",
].join(" ");

export class OpenAiCompatibleTranslationProvider implements TranslationProvider {
  readonly id = OPENAI_COMPATIBLE_TRANSLATION_PROVIDER_ID;
  readonly displayName = "OpenAI-compatible translation API";
  readonly capabilities: TranslationProviderCapabilities = {
    supportsBatchTranslation: true,
    // Part 10 territory: the adapter could send neighbouring lines, but Part 9
    // deliberately does not, so the capability reports what is actually wired.
    supportsContext: false,
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
   * The request the model sees: stable ids beside source text, and the language
   * pair named explicitly. The target language is never left for the model to
   * infer — that is Aidub's decision, taken from the project.
   */
  private userPrompt(request: TranslationRequest): string {
    const segments = request.segments.map((segment) => ({
      segmentId: segment.segmentId,
      text: segment.sourceText,
    }));

    return [
      `Translate each line from ${getLanguageLabel(request.sourceLanguage)} (${request.sourceLanguage})`,
      ` to ${getLanguageLabel(request.targetLanguage)} (${request.targetLanguage}).`,
      `\nReturn one entry per segmentId, unchanged.\n\n`,
      JSON.stringify({ segments }, null, 2),
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
