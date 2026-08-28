import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DiarizationResult, SpeakerRegion } from "@/types/diarization";
import type { Transcript, TranscriptSegment } from "@/types/transcript";
import type { UnifiedDialogue } from "@/types/dialogue";
import type { ProcessingJob, TranslateJobResult } from "@/types/processing-job";
import type { TranslationRequest } from "@/types/translation";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import { DevelopmentDialogueRepository } from "@/data/dialogue/development-dialogue-repository";
import { DevelopmentTranslationRepository } from "@/data/translations/development-translation-repository";
import { DialogueService } from "@/server/dialogue/dialogue-service";
import { DialogueEditorService } from "@/server/dialogue/dialogue-editor-service";
import { ProcessingError } from "@/server/processing/processing-errors";
import type { StageRunContext } from "@/server/processing/processing-service";
import { TranslationService } from "@/server/translation/translation-service";
import { createTranslationProviderRegistry } from "@/server/translation/translation-provider-registry";
import { MockTranslationProvider } from "@/server/translation/providers/mock-provider";
import { translationError } from "@/server/translation/translation-errors";
import type {
  TranslationProvider,
  TranslationProviderContext,
  TranslationProviderResult,
} from "@/server/translation/translation-provider";

/**
 * The translation service end to end: real repositories, real merge, real
 * Part 8 editing, real persistence — only the provider is a double.
 *
 * These tests exist to pin the promises Part 9 rests on:
 *
 * - translation reads the **corrected** dialogue, never the raw transcript;
 * - it never writes to the dialogue, the transcript or the diarization;
 * - every dialogue line comes back exactly once, with its own speaker and
 *   timing, in timeline order, whatever the provider did;
 * - a translation is bound to one dialogue revision and language pair;
 * - a cancelled or rejected run persists nothing.
 */

const PROJECT = "project-a";
const MEDIA = "media-a";
const LANGUAGES = { sourceLanguage: "en", targetLanguage: "pl" };

function segment(
  id: string,
  startTime: number,
  endTime: number,
  originalText: string,
): TranscriptSegment {
  return {
    id,
    startTime,
    endTime,
    originalText,
    status: "completed",
    confidence: null,
  };
}

function region(
  id: string,
  speakerId: string,
  startTime: number,
  endTime: number,
): SpeakerRegion {
  return { id, speakerId, startTime, endTime, confidence: null, overlap: false };
}

function transcript(): Transcript {
  return {
    id: "transcript-a",
    projectId: PROJECT,
    sourceMediaId: MEDIA,
    audioArtifactId: "artifact-a",
    providerId: "stt",
    providerModel: "stt-model",
    language: "en",
    status: "completed",
    segments: [
      segment("t-1", 0, 2, "Helo."),
      segment("t-2", 2, 4, "How are you?"),
    ],
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

function diarization(): DiarizationResult {
  return {
    id: "diarization-a",
    projectId: PROJECT,
    sourceMediaId: MEDIA,
    audioArtifactId: "artifact-a",
    providerId: "diarizer",
    providerModel: "diarizer-model",
    status: "completed",
    speakers: [
      { id: "speaker_1", label: "Speaker 1", confidence: null },
      { id: "speaker_2", label: "Speaker 2", confidence: null },
    ],
    regions: [
      region("r-1", "speaker_1", 0, 2),
      region("r-2", "speaker_2", 2, 4),
    ],
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

/** A provider whose behaviour a test dictates. */
function stubProvider(
  translate: (
    request: TranslationRequest,
    context?: TranslationProviderContext,
  ) => Promise<TranslationProviderResult>,
  overrides: Partial<Pick<TranslationProvider, "id" | "capabilities">> = {},
): TranslationProvider {
  return {
    id: overrides.id ?? "stub",
    displayName: "Stub translator",
    capabilities: overrides.capabilities ?? {
      supportsBatchTranslation: true,
      supportsContext: false,
      supportsGlossary: false,
      supportsConfidence: false,
      reportsUsage: false,
    },
    isAvailable: async () => true,
    translate,
  };
}

function echo(
  request: TranslationRequest,
  transform: (text: string, segmentId: string) => string = (text) => `[pl] ${text}`,
): TranslationProviderResult {
  return {
    sourceLanguage: request.sourceLanguage,
    targetLanguage: request.targetLanguage,
    segments: request.segments.map((s) => ({
      segmentId: s.segmentId,
      translatedText: transform(s.sourceText, s.segmentId),
      confidence: null,
    })),
    provider: { id: "stub", model: "stub-model" },
    usage: null,
  };
}

describe("TranslationService", () => {
  let root: string;
  let transcripts: DevelopmentTranscriptRepository;
  let diarizations: DevelopmentDiarizationRepository;
  let dialogues: DevelopmentDialogueRepository;
  let translations: DevelopmentTranslationRepository;
  let dialogueService: DialogueService;
  let editor: DialogueEditorService;
  let idCounter = 0;

  beforeEach(async () => {
    idCounter = 0;
    root = await mkdtemp(path.join(tmpdir(), "aidub-translation-"));
    transcripts = new DevelopmentTranscriptRepository(
      path.join(root, "transcripts"),
    );
    diarizations = new DevelopmentDiarizationRepository(
      path.join(root, "diarizations"),
    );
    dialogues = new DevelopmentDialogueRepository(path.join(root, "dialogues"));
    translations = new DevelopmentTranslationRepository(
      path.join(root, "translations"),
    );
    dialogueService = new DialogueService({
      transcripts,
      diarizations,
      dialogues,
      logger: () => {},
    });
    editor = new DialogueEditorService({ dialogues, logger: () => {} });

    await transcripts.save(transcript());
    await diarizations.save(diarization());
    await currentDialogue();
  });

  async function currentDialogue(): Promise<UnifiedDialogue> {
    const resolution = await dialogueService.getCurrentDialogue(PROJECT, MEDIA);

    if (resolution.state !== "ready" || !resolution.dialogue) {
      throw new Error(`expected a dialogue, got ${resolution.state}`);
    }

    return resolution.dialogue;
  }

  function createService(
    provider: TranslationProvider = new MockTranslationProvider(),
  ) {
    return new TranslationService({
      registry: createTranslationProviderRegistry([provider], provider.id),
      translations,
      dialogues: dialogueService,
      // Unique across every service this test builds, the way randomUUID is.
      createId: () => `id-${++idCounter}`,
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      logger: () => {},
      config: { batchSize: 20, requestTimeoutMs: 5_000 },
    });
  }

  function job(
    dialogue: UnifiedDialogue,
    overrides: Partial<ProcessingJob> = {},
    languages = LANGUAGES,
  ): ProcessingJob {
    return {
      id: "job-1",
      projectId: PROJECT,
      sourceMediaId: MEDIA,
      type: "translate",
      status: "processing",
      progress: 1,
      indeterminate: false,
      stage: null,
      createdAt: "2026-08-28T11:00:00.000Z",
      updatedAt: "2026-08-28T11:00:00.000Z",
      startedAt: "2026-08-28T11:00:00.000Z",
      completedAt: null,
      error: null,
      result: null,
      providerId: null,
      languageHint: null,
      audioArtifactId: null,
      parameters: {
        kind: "translate",
        dialogueId: dialogue.id,
        dialogueRevision: dialogue.editMetadata.revision,
        ...languages,
      },
      ...overrides,
    };
  }

  function context(
    dialogue: UnifiedDialogue,
    overrides: { signal?: AbortSignal; job?: Partial<ProcessingJob> } = {},
  ): {
    context: StageRunContext;
    progress: { progress: number; stage?: string }[];
  } {
    const progress: { progress: number; stage?: string }[] = [];

    return {
      progress,
      context: {
        job: job(dialogue, overrides.job),
        signal: overrides.signal ?? new AbortController().signal,
        ensureAudio: () => {
          throw new Error("translation must never ask for audio");
        },
        onProgress: (value, stage) => progress.push({ progress: value, stage }),
      },
    };
  }

  async function run(
    provider?: TranslationProvider,
    overrides: { signal?: AbortSignal; job?: Partial<ProcessingJob> } = {},
  ) {
    const dialogue = await currentDialogue();
    const { context: ctx, progress } = context(dialogue, overrides);
    const result = (await createService(provider).run(ctx)) as TranslateJobResult;

    return { dialogue, result, progress };
  }

  describe("basic translation", () => {
    it("translates every dialogue line and persists the result", async () => {
      const { dialogue, result } = await run();

      expect(result.kind).toBe("translate");
      expect(result.segmentCount).toBe(2);
      expect(result.dialogueId).toBe(dialogue.id);
      expect(result.sourceLanguage).toBe("en");
      expect(result.targetLanguage).toBe("pl");

      const stored = await translations.getById(result.translationId);

      expect(stored?.segments).toHaveLength(2);
      expect(stored?.status).toBe("completed");
    });

    it("keeps the dialogue segment id, speaker and timing on every line", async () => {
      const { dialogue, result } = await run();
      const stored = await translations.getById(result.translationId);

      expect(stored?.segments.map((s) => s.dialogueSegmentId)).toEqual(
        dialogue.segments.map((s) => s.id),
      );
      expect(stored?.segments.map((s) => s.speakerId)).toEqual(
        dialogue.segments.map((s) => s.speakerId),
      );
      expect(stored?.segments.map((s) => [s.startTime, s.endTime])).toEqual(
        dialogue.segments.map((s) => [s.startTime, s.endTime]),
      );
    });

    it("stores translated text separately from the source text", async () => {
      const { dialogue, result } = await run();
      const stored = await translations.getById(result.translationId);

      for (const [index, translated] of (stored?.segments ?? []).entries()) {
        expect(translated.sourceText).toBe(dialogue.segments[index].originalText);
        expect(translated.translatedText).not.toBe(translated.sourceText);
        expect(translated.translatedText).toContain(translated.sourceText);
      }
    });

    it("gives each translated segment its own id, not the dialogue's", async () => {
      const { dialogue, result } = await run();
      const stored = await translations.getById(result.translationId);
      const ids = (stored?.segments ?? []).map((s) => s.id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).not.toEqual(dialogue.segments.map((s) => s.id));
    });

    it("records the provider and model that produced it", async () => {
      const { result } = await run();
      const stored = await translations.getById(result.translationId);

      expect(stored?.providerId).toBe("mock");
      expect(stored?.providerModel).toBe("deterministic-v1");
    });

    it("reports real progress and a line-count stage", async () => {
      const { progress } = await run();
      const stages = progress.map((entry) => entry.stage).filter(Boolean);

      expect(progress.map((entry) => entry.progress)).toEqual(
        [...progress.map((entry) => entry.progress)].sort((a, b) => a - b),
      );
      expect(stages).toContain("Preparing dialogue");
      expect(stages.some((stage) => /Translating \d+ of 2 lines/.test(stage!))).toBe(
        true,
      );
      expect(stages).toContain("Saving translation");
    });

    it("never asks the processing layer for audio", async () => {
      // `ensureAudio` throws in the harness: translation reads the dialogue,
      // so a job that needed media would fail loudly here.
      await expect(run()).resolves.toBeDefined();
    });
  });

  describe("provider ordering and contract", () => {
    it("restores dialogue order however the provider answered", async () => {
      const { dialogue, result } = await run(
        // The mock deliberately answers in reverse.
        new MockTranslationProvider(),
      );
      const stored = await translations.getById(result.translationId);

      expect(stored?.segments.map((s) => s.dialogueSegmentId)).toEqual(
        dialogue.segments.map((s) => s.id),
      );
      expect(stored?.segments.map((s) => s.startTime)).toEqual(
        [...(stored?.segments ?? [])].map((s) => s.startTime).sort((a, b) => a - b),
      );
    });

    it("fails and stores nothing when a line is missing", async () => {
      const provider = stubProvider(async (request) => ({
        ...echo(request),
        segments: echo(request).segments.slice(0, 1),
      }));

      await expect(run(provider)).rejects.toMatchObject({
        code: "TRANSLATION_INCOMPLETE_RESPONSE",
      });
      expect(await translations.listByProject(PROJECT)).toEqual([]);
    });

    it("fails and stores nothing when a line is returned twice", async () => {
      const provider = stubProvider(async (request) => {
        const base = echo(request);

        return { ...base, segments: [base.segments[0], base.segments[0], base.segments[1]] };
      });

      await expect(run(provider)).rejects.toMatchObject({
        code: "TRANSLATION_DUPLICATE_SEGMENT",
      });
      expect(await translations.listByProject(PROJECT)).toEqual([]);
    });

    it("fails and stores nothing when the provider invents a line", async () => {
      const provider = stubProvider(async (request) => {
        const base = echo(request);

        return {
          ...base,
          segments: [
            ...base.segments,
            { segmentId: "not-a-real-segment", translatedText: "???", confidence: null },
          ],
        };
      });

      await expect(run(provider)).rejects.toMatchObject({
        code: "TRANSLATION_UNKNOWN_SEGMENT",
      });
      expect(await translations.listByProject(PROJECT)).toEqual([]);
    });

    it("fails when a line with text comes back empty", async () => {
      const provider = stubProvider(async (request) =>
        echo(request, (_text, segmentId) => (segmentId.endsWith("t-2") ? "" : "ok")),
      );

      await expect(run(provider)).rejects.toMatchObject({
        code: "TRANSLATION_EMPTY_RESULT",
      });
      expect(await translations.listByProject(PROJECT)).toEqual([]);
    });

    it("never fabricates a confidence", async () => {
      const provider = stubProvider(async (request) => ({
        ...echo(request),
        segments: echo(request).segments.map((s) => ({
          ...s,
          // Out of range: the provider means something we cannot interpret.
          confidence: 7,
        })),
      }));

      const { result } = await run(provider);
      const stored = await translations.getById(result.translationId);

      expect(stored?.segments.every((s) => s.confidence === null)).toBe(true);
    });

    it("keeps a confidence a provider genuinely reports", async () => {
      const provider = stubProvider(async (request) => ({
        ...echo(request),
        segments: echo(request).segments.map((s) => ({ ...s, confidence: 0.75 })),
      }));

      const { result } = await run(provider);
      const stored = await translations.getById(result.translationId);

      expect(stored?.segments.every((s) => s.confidence === 0.75)).toBe(true);
    });
  });

  describe("empty source segments", () => {
    it("preserves an empty line without sending it to the provider", async () => {
      const dialogue = await currentDialogue();
      await editor.applyEdit(PROJECT, MEDIA, {
        type: "update_text",
        segmentId: dialogue.segments[1].id,
        text: "",
      });

      const seen: string[] = [];
      const provider = stubProvider(async (request) => {
        seen.push(...request.segments.map((s) => s.segmentId));
        return echo(request);
      });

      const { result } = await run(provider);
      const stored = await translations.getById(result.translationId);

      // Structure is still 1:1 …
      expect(stored?.segments).toHaveLength(2);
      // … but the blank line never cost a provider call.
      expect(seen).toHaveLength(1);
      expect(stored?.segments[1].sourceText).toBe("");
      expect(stored?.segments[1].translatedText).toBe("");
    });
  });

  describe("Part 8 corrections are what gets translated", () => {
    it("sends corrected text, speakers and timing, not the raw transcript", async () => {
      const original = await currentDialogue();

      await editor.applyEdit(PROJECT, MEDIA, {
        type: "update_text",
        segmentId: original.segments[0].id,
        text: "Hello.",
      });
      await editor.applyEdit(PROJECT, MEDIA, {
        type: "reassign_speaker",
        segmentId: original.segments[0].id,
        speakerId: "speaker_2",
      });
      await editor.applyEdit(PROJECT, MEDIA, {
        type: "update_timing",
        segmentId: original.segments[0].id,
        startTime: 0.5,
        endTime: 1.75,
      });

      let received: TranslationRequest | null = null;
      const provider = stubProvider(async (request) => {
        received = request;
        return echo(request);
      });

      const { result } = await run(provider);
      const sent = received as unknown as TranslationRequest;

      // The raw transcript still says "Helo." — the provider was given the
      // corrected line.
      expect(sent.segments[0].sourceText).toBe("Hello.");
      expect(sent.segments[0].speakerId).toBe("speaker_2");
      expect(sent.segments[0].startTime).toBe(0.5);
      expect((await transcripts.getByProject(PROJECT, MEDIA))?.segments[0].originalText).toBe(
        "Helo.",
      );

      const stored = await translations.getById(result.translationId);

      expect(stored?.segments[0].sourceText).toBe("Hello.");
      expect(stored?.segments[0].speakerId).toBe("speaker_2");
      expect(stored?.segments[0].startTime).toBe(0.5);
    });

    it("translates a split structure as it now stands", async () => {
      const original = await currentDialogue();

      await editor.applyEdit(PROJECT, MEDIA, {
        type: "split_segment",
        segmentId: original.segments[0].id,
        splitTime: 1,
        firstText: "Hello",
        secondText: "there.",
      });

      const { result } = await run();
      const stored = await translations.getById(result.translationId);
      const dialogue = await currentDialogue();

      expect(stored?.segments).toHaveLength(3);
      expect(stored?.segments.map((s) => s.dialogueSegmentId)).toEqual(
        dialogue.segments.map((s) => s.id),
      );
    });
  });

  describe("raw data and dialogue immutability", () => {
    it("changes neither the dialogue, the transcript nor the diarization", async () => {
      const dialogueBefore = JSON.stringify(await currentDialogue());
      const transcriptBefore = JSON.stringify(
        await transcripts.getByProject(PROJECT, MEDIA),
      );
      const diarizationBefore = JSON.stringify(
        await diarizations.getByProjectAndSource(PROJECT, MEDIA),
      );

      await run();

      expect(JSON.stringify(await currentDialogue())).toBe(dialogueBefore);
      expect(
        JSON.stringify(await transcripts.getByProject(PROJECT, MEDIA)),
      ).toBe(transcriptBefore);
      expect(
        JSON.stringify(await diarizations.getByProjectAndSource(PROJECT, MEDIA)),
      ).toBe(diarizationBefore);
    });
  });

  describe("dialogue revision and staleness", () => {
    it("binds a translation to the revision it translated", async () => {
      const { dialogue, result } = await run();
      const stored = await translations.getById(result.translationId);

      expect(stored?.dialogueRevision).toBe(dialogue.editMetadata.revision);
    });

    it("stops being current once the dialogue is edited", async () => {
      const { result } = await run();
      const before = await currentDialogue();

      await editor.applyEdit(PROJECT, MEDIA, {
        type: "update_text",
        segmentId: before.segments[0].id,
        text: "Hello there.",
      });

      const after = await currentDialogue();
      const resolution = await createService().getCurrentTranslation(
        after,
        LANGUAGES,
      );

      // Still stored, still findable — just no longer current.
      expect(resolution.translation?.id).toBe(result.translationId);
      expect(resolution.current).toBe(false);
      expect(resolution.staleReason).toBe("dialogue_revision_changed");
    });

    it("is not offered as current for another target language", async () => {
      await run();
      const dialogue = await currentDialogue();

      const resolution = await createService().getCurrentTranslation(dialogue, {
        sourceLanguage: "en",
        targetLanguage: "fr",
      });

      expect(resolution.translation).toBeNull();
    });

    it("rejects a job whose dialogue has already moved on", async () => {
      const stale = await currentDialogue();

      await editor.applyEdit(PROJECT, MEDIA, {
        type: "update_text",
        segmentId: stale.segments[0].id,
        text: "Changed already.",
      });

      const { context: ctx } = context(stale);

      await expect(createService().run(ctx)).rejects.toMatchObject({
        code: "TRANSLATION_SOURCE_CHANGED",
      });
      expect(await translations.listByProject(PROJECT)).toEqual([]);
    });

    it("discards a result when the dialogue changes while the provider works", async () => {
      const dialogue = await currentDialogue();
      const provider = stubProvider(async (request) => {
        // The edit lands mid-flight, exactly as a person typing would.
        await editor.applyEdit(PROJECT, MEDIA, {
          type: "update_text",
          segmentId: dialogue.segments[0].id,
          text: "Edited during translation.",
        });

        return echo(request);
      });

      const { context: ctx } = context(dialogue);

      await expect(createService(provider).run(ctx)).rejects.toMatchObject({
        code: "TRANSLATION_SOURCE_CHANGED",
      });
      expect(await translations.listByProject(PROJECT)).toEqual([]);
    });
  });

  describe("retranslation", () => {
    it("replaces the previous translation for the same identity", async () => {
      const first = await run();
      const second = await run();

      expect(second.result.translationId).not.toBe(first.result.translationId);

      const all = await translations.listByProject(PROJECT);

      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(second.result.translationId);
    });

    it("leaves the working translation in place when a rerun fails", async () => {
      const first = await run();
      const failing = stubProvider(async () => {
        throw translationError("TRANSLATION_REQUEST_FAILED");
      });

      await expect(run(failing)).rejects.toMatchObject({
        code: "TRANSLATION_REQUEST_FAILED",
      });

      const stored = await translations.getById(first.result.translationId);

      expect(stored).not.toBeNull();
    });
  });

  describe("cancellation", () => {
    it("saves nothing when cancelled while the provider is working", async () => {
      const dialogue = await currentDialogue();
      const controller = new AbortController();
      const provider = stubProvider(async (request) => {
        controller.abort();
        return echo(request);
      });

      const { context: ctx } = context(dialogue, {
        signal: controller.signal,
      });

      await expect(createService(provider).run(ctx)).rejects.toMatchObject({
        code: "CANCELLED",
      });
      expect(await translations.listByProject(PROJECT)).toEqual([]);
    });

    it("reaches the job layer as a cancellation, not a failure", async () => {
      const dialogue = await currentDialogue();
      const controller = new AbortController();
      controller.abort();

      const { context: ctx } = context(dialogue, { signal: controller.signal });
      const failure = await createService()
        .run(ctx)
        .catch((cause: unknown) => cause);

      expect(failure).toBeInstanceOf(ProcessingError);
      expect((failure as ProcessingError).code).toBe("CANCELLED");
    });

    it("stops before spending another provider call", async () => {
      const dialogue = await currentDialogue();
      const controller = new AbortController();
      let calls = 0;

      const provider = stubProvider(
        async (request) => {
          calls += 1;
          controller.abort();
          return echo(request);
        },
        {
          // One line per call, so there is a second batch to skip.
          capabilities: {
            supportsBatchTranslation: false,
            supportsContext: false,
            supportsGlossary: false,
            supportsConfidence: false,
            reportsUsage: false,
          },
        },
      );

      const { context: ctx } = context(dialogue, { signal: controller.signal });

      await expect(createService(provider).run(ctx)).rejects.toMatchObject({
        code: "CANCELLED",
      });
      expect(calls).toBe(1);
    });
  });

  describe("batching", () => {
    it("drives a provider that cannot batch one line at a time", async () => {
      const sizes: number[] = [];
      const provider = stubProvider(
        async (request) => {
          sizes.push(request.segments.length);
          return echo(request);
        },
        {
          capabilities: {
            supportsBatchTranslation: false,
            supportsContext: false,
            supportsGlossary: false,
            supportsConfidence: false,
            reportsUsage: false,
          },
        },
      );

      const { result } = await run(provider);

      expect(sizes).toEqual([1, 1]);
      expect(result.segmentCount).toBe(2);
    });

    it("adds up usage across batches", async () => {
      const provider = stubProvider(
        async (request) => ({
          ...echo(request),
          usage: { inputTokens: 10, requestCount: 1 },
        }),
        {
          capabilities: {
            supportsBatchTranslation: false,
            supportsContext: false,
            supportsGlossary: false,
            supportsConfidence: false,
            reportsUsage: true,
          },
        },
      );

      const { result } = await run(provider);
      const stored = await translations.getById(result.translationId);

      expect(stored?.usage).toEqual({ inputTokens: 20, requestCount: 2 });
    });

    it("records no usage when the provider reports none", async () => {
      const { result } = await run(stubProvider(async (request) => echo(request)));
      const stored = await translations.getById(result.translationId);

      expect(stored?.usage).toBeNull();
    });
  });

  describe("guard rails", () => {
    it("refuses to translate a language into itself", async () => {
      const dialogue = await currentDialogue();
      const ctx = context(dialogue).context;
      ctx.job = job(dialogue, {}, { sourceLanguage: "en", targetLanguage: "en" });

      await expect(createService().run(ctx)).rejects.toMatchObject({
        code: "TRANSLATION_SAME_LANGUAGE",
      });
    });

    it("refuses a job created without translation parameters", async () => {
      const dialogue = await currentDialogue();
      const ctx = context(dialogue, { job: { parameters: null } }).context;

      await expect(createService().run(ctx)).rejects.toMatchObject({
        code: "TRANSLATION_SOURCE_REQUIRED",
      });
    });

    it("refuses when the provider is not configured", async () => {
      const unavailable = stubProvider(async (request) => echo(request));
      const dialogue = await currentDialogue();
      const service = new TranslationService({
        registry: createTranslationProviderRegistry(
          [{ ...unavailable, isAvailable: async () => false }],
          unavailable.id,
        ),
        translations,
        dialogues: dialogueService,
        logger: () => {},
      });

      await expect(service.run(context(dialogue).context)).rejects.toMatchObject({
        code: "TRANSLATION_PROVIDER_UNAVAILABLE",
      });
    });

    it("fails rather than reporting success when saving fails", async () => {
      const dialogue = await currentDialogue();
      vi.spyOn(translations, "save").mockRejectedValueOnce(new Error("disk full"));

      await expect(
        createService().run(context(dialogue).context),
      ).rejects.toMatchObject({ code: "TRANSLATION_SAVE_FAILED" });
    });
  });

  describe("resolveCurrent", () => {
    it("reports a ready translation", async () => {
      await run();

      const resolution = await createService().resolveCurrent(
        PROJECT,
        MEDIA,
        LANGUAGES,
      );

      expect(resolution.state).toBe("ready");
      expect(resolution.translation).not.toBeNull();
      expect(resolution.dialogue?.segmentCount).toBe(2);
    });

    it("reports an untranslated dialogue", async () => {
      const resolution = await createService().resolveCurrent(
        PROJECT,
        MEDIA,
        LANGUAGES,
      );

      expect(resolution.state).toBe("not_translated");
      expect(resolution.translation).toBeNull();
    });

    it("reports a stale translation as stale, keeping it visible", async () => {
      await run();
      const dialogue = await currentDialogue();

      await editor.applyEdit(PROJECT, MEDIA, {
        type: "update_text",
        segmentId: dialogue.segments[0].id,
        text: "Changed.",
      });

      const resolution = await createService().resolveCurrent(
        PROJECT,
        MEDIA,
        LANGUAGES,
      );

      expect(resolution.state).toBe("stale");
      expect(resolution.translation).not.toBeNull();
      expect(resolution.staleReason).toBe("dialogue_revision_changed");
    });

    it("refuses a matching language pair before touching the dialogue", async () => {
      const resolution = await createService().resolveCurrent(PROJECT, MEDIA, {
        sourceLanguage: "en",
        targetLanguage: "en",
      });

      expect(resolution.state).toBe("same_language");
    });

    it("reports a missing dialogue rather than inventing one", async () => {
      const resolution = await createService().resolveCurrent(
        PROJECT,
        "media-that-does-not-exist",
        LANGUAGES,
      );

      expect(resolution.state).toBe("dialogue_required");
      expect(resolution.translation).toBeNull();
    });
  });

  describe("project and source isolation", () => {
    it("keeps one project's translation out of another", async () => {
      await run();

      const otherTranscript = { ...transcript(), id: "transcript-b", projectId: "project-b" };
      const otherDiarization = {
        ...diarization(),
        id: "diarization-b",
        projectId: "project-b",
      };
      await transcripts.save(otherTranscript);
      await diarizations.save(otherDiarization);

      const other = await dialogueService.getCurrentDialogue("project-b", MEDIA);

      if (other.state !== "ready" || !other.dialogue) {
        throw new Error("expected a dialogue for project-b");
      }

      const resolution = await createService().getCurrentTranslation(
        other.dialogue,
        LANGUAGES,
      );

      expect(resolution.translation).toBeNull();
      expect(await translations.listByProject("project-b")).toEqual([]);
      expect(await translations.listByProject(PROJECT)).toHaveLength(1);
    });
  });
});
