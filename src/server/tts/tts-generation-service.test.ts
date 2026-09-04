import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { DiarizationResult, SpeakerRegion } from "@/types/diarization";
import type { Transcript, TranscriptSegment } from "@/types/transcript";
import type { UnifiedDialogue } from "@/types/dialogue";
import type { ProcessingJob } from "@/types/processing-job";
import type { DialogueTranslation } from "@/types/translation";
import type { GeneratedSpeechSegment, VoiceSource } from "@/types/tts";
import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import { DevelopmentDialogueRepository } from "@/data/dialogue/development-dialogue-repository";
import { DevelopmentTranslationRepository } from "@/data/translations/development-translation-repository";
import { DevelopmentGeneratedSpeechRepository } from "@/data/tts/development-generated-speech-repository";
import { DevelopmentVoiceAssignmentRepository } from "@/data/tts/development-voice-assignment-repository";
import { wavDurationSeconds } from "@/lib/tts/generated-duration";
import { DialogueService } from "@/server/dialogue/dialogue-service";
import { DialogueEditorService } from "@/server/dialogue/dialogue-editor-service";
import { DevelopmentArtifactStorage } from "@/server/artifacts/development-artifact-storage";
import type { ProcessingError } from "@/server/processing/processing-errors";
import type { StageRunContext } from "@/server/processing/processing-service";
import { TranslationService } from "@/server/translation/translation-service";
import { createTranslationProviderRegistry } from "@/server/translation/translation-provider-registry";
import { MockTranslationProvider } from "@/server/translation/providers/mock-provider";
import { TtsGenerationService } from "@/server/tts/tts-generation-service";
import { createTtsProviderRegistry } from "@/server/tts/tts-provider-registry";
import { MockTtsProvider } from "@/server/tts/providers/mock-provider";
import type { TtsProvider } from "@/server/tts/tts-provider";

/**
 * Speech generation end to end: real repositories, real merge, real Part 8
 * editing, real Part 9/10 translation, real artifact storage — only the speech
 * provider is a double, and even that returns genuine WAV bytes.
 *
 * These tests exist to pin the promises Part 11 rests on:
 *
 * - generation speaks the **current translation**, never the raw transcript;
 * - it never writes to the translation, the dialogue, the transcript or the
 *   diarization;
 * - a voice comes from a person's assignment, and a missing one stops the run
 *   rather than being chosen by this code;
 * - audio is bound to one exact line, revision, speaker, voice and setting, and
 *   goes stale the moment any of those move;
 * - a failure keeps whatever audio a person already had.
 */

const PROJECT = "project-a";
const MEDIA = "media-a";
const LANGUAGES = { sourceLanguage: "en", targetLanguage: "pl" };
const VOICE_A: VoiceSource = {
  type: "standard",
  providerId: "mock",
  voiceId: "mock-voice-a",
};
const VOICE_B: VoiceSource = {
  type: "standard",
  providerId: "mock",
  voiceId: "mock-voice-b",
};

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
      segment("t-1", 0, 3, "Hello there."),
      segment("t-2", 3, 7, "How are you today?"),
      segment("t-3", 7, 9, "..."),
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
      region("r-1", "speaker_1", 0, 3),
      region("r-2", "speaker_2", 3, 7),
      region("r-3", "speaker_1", 7, 9),
    ],
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
  };
}

describe("TtsGenerationService", () => {
  let root: string;
  let transcripts: DevelopmentTranscriptRepository;
  let diarizations: DevelopmentDiarizationRepository;
  let dialogues: DevelopmentDialogueRepository;
  let translations: DevelopmentTranslationRepository;
  let assignments: DevelopmentVoiceAssignmentRepository;
  let generated: DevelopmentGeneratedSpeechRepository;
  let artifacts: DevelopmentArtifactStorage;
  let dialogueService: DialogueService;
  let editor: DialogueEditorService;
  let translationService: TranslationService;
  let idCounter = 0;

  beforeEach(async () => {
    idCounter = 0;
    root = await mkdtemp(path.join(tmpdir(), "aidub-tts-"));
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
    assignments = new DevelopmentVoiceAssignmentRepository(
      path.join(root, "assignments"),
    );
    generated = new DevelopmentGeneratedSpeechRepository(
      path.join(root, "generated"),
    );
    artifacts = new DevelopmentArtifactStorage(path.join(root, "artifacts"));
    dialogueService = new DialogueService({
      transcripts,
      diarizations,
      dialogues,
      logger: () => {},
    });
    editor = new DialogueEditorService({ dialogues, logger: () => {} });

    const provider = new MockTranslationProvider();
    translationService = new TranslationService({
      registry: createTranslationProviderRegistry([provider], provider.id),
      translations,
      dialogues: dialogueService,
      createId: () => `tr-${++idCounter}`,
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      logger: () => {},
      config: { batchSize: 20, requestTimeoutMs: 5_000 },
    });

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

  /** Runs a real Part 9 translation so speech has something honest to speak. */
  async function translate(): Promise<DialogueTranslation> {
    const dialogue = await currentDialogue();
    const result = await translationService.run({
      job: translateJob(dialogue),
      signal: new AbortController().signal,
      ensureAudio: () => {
        throw new Error("translation must never ask for audio");
      },
      onProgress: () => {},
    });

    const stored = await translations.getById(
      (result as { translationId: string }).translationId,
    );

    if (!stored) {
      throw new Error("expected a stored translation");
    }

    return stored;
  }

  /** A manual Part 10 edit to one translated line, as a person would make. */
  async function editTranslation(
    translation: DialogueTranslation,
    dialogueSegmentId: string,
    text: string,
  ): Promise<DialogueTranslation> {
    const outcome = await translationService.editSegmentText(
      PROJECT,
      MEDIA,
      LANGUAGES,
      dialogueSegmentId,
      text,
      translation.revision,
    );

    if (!outcome.ok) {
      throw new Error(`edit rejected: ${outcome.code}`);
    }

    return outcome.translation;
  }

  function translateJob(dialogue: UnifiedDialogue): ProcessingJob {
    return {
      ...baseJob(),
      type: "translate",
      parameters: {
        kind: "translate",
        operation: "full",
        dialogueId: dialogue.id,
        dialogueRevision: dialogue.editMetadata.revision,
        segmentId: null,
        expectedTranslationRevision: null,
        ...LANGUAGES,
      },
    };
  }

  function baseJob(): ProcessingJob {
    return {
      id: "job-1",
      projectId: PROJECT,
      sourceMediaId: MEDIA,
      type: "generate_speech",
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
      parameters: null,
    };
  }

  function createService(provider: TtsProvider = new MockTtsProvider()) {
    return new TtsGenerationService({
      registry: createTtsProviderRegistry([provider], provider.id),
      assignments,
      generated,
      translations: translationService,
      artifacts,
      createId: () => `sp-${++idCounter}`,
      now: () => new Date("2026-08-28T13:00:00.000Z"),
      logger: () => {},
      config: { requestTimeoutMs: 5_000 },
    });
  }

  function identityFor(translation: DialogueTranslation) {
    return {
      projectId: PROJECT,
      sourceMediaId: MEDIA,
      dialogueId: translation.dialogueId,
      targetLanguage: "pl",
    };
  }

  async function castEveryone(
    service: TtsGenerationService,
    translation: DialogueTranslation,
  ): Promise<void> {
    const identity = identityFor(translation);
    await service.assignVoice(identity, "speaker_1", VOICE_A);
    await service.assignVoice(identity, "speaker_2", VOICE_B);
  }

  function speechContext(
    translation: DialogueTranslation,
    overrides: {
      signal?: AbortSignal;
      operation?: "full_project" | "single_segment";
      dialogueSegmentId?: string | null;
      regenerateAll?: boolean;
      translationRevision?: number;
    } = {},
  ): { context: StageRunContext; progress: number[] } {
    const progress: number[] = [];

    return {
      progress,
      context: {
        job: {
          ...baseJob(),
          parameters: {
            kind: "generate_speech",
            operation: overrides.operation ?? "full_project",
            dialogueId: translation.dialogueId,
            translationId: translation.id,
            translationRevision:
              overrides.translationRevision ?? translation.revision,
            targetLanguage: "pl",
            dialogueSegmentId: overrides.dialogueSegmentId ?? null,
            regenerateAll: overrides.regenerateAll ?? false,
          },
        },
        signal: overrides.signal ?? new AbortController().signal,
        ensureAudio: () => {
          throw new Error("speech generation must never ask for audio");
        },
        onProgress: (value) => progress.push(value),
      },
    };
  }

  it("speaks every line of the current translation", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);

    const { context, progress } = speechContext(translation);
    const result = await service.run(context);

    expect(result).toMatchObject({
      kind: "generate_speech",
      translationId: translation.id,
      targetLanguage: "pl",
      failedCount: 0,
    });

    const stored = await generated.listByIdentity(identityFor(translation));

    // One record per translated line, whatever happened to each of them.
    expect(stored).toHaveLength(translation.segments.length);
    expect(progress.at(-1)).toBe(95);

    for (const record of stored) {
      if (record.status !== "completed") continue;

      const bytes = await artifacts.read(record.artifactId as string);
      expect(bytes).not.toBeNull();
      // Real, readable audio — not a placeholder record claiming to be one.
      expect(wavDurationSeconds(bytes as Uint8Array)).toBeCloseTo(
        record.durationSeconds as number,
        2,
      );
    }
  });

  it("records a line with nothing to say as intentionally silent", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);

    // Someone shortened a line down to an ellipsis: punctuation is not speech.
    const target = translation.segments[0];
    const edited = await editTranslation(translation, target.dialogueSegmentId, "…");

    await service.run(speechContext(edited).context);

    const record = await generated.getBySegment(
      identityFor(edited),
      target.dialogueSegmentId,
    );

    expect(record?.status).toBe("skipped_empty");
    expect(record?.artifactId).toBeNull();
    // A silent line is not a failure and not a gap: it is a recorded outcome.
    expect(record?.durationSeconds).toBeNull();

    const resolution = await service.resolveCurrent(PROJECT, MEDIA, "pl");
    const view = resolution.segments.find(
      (segment) => segment.dialogueSegmentId === target.dialogueSegmentId,
    );

    // And it counts as current, not as work still to do.
    expect(view?.current).toBe(true);
  });

  it("refuses to generate when a speaker has no voice", async () => {
    const service = createService();
    const translation = await translate();
    await service.assignVoice(
      identityFor(translation),
      "speaker_1",
      VOICE_A,
    );

    await expect(
      service.run(speechContext(translation).context),
    ).rejects.toMatchObject({ code: "TTS_VOICE_ASSIGNMENT_REQUIRED" });

    // Nothing was spoken, so nothing was stored: the run stops before the
    // first provider call rather than half-dubbing the project.
    expect(await generated.listByIdentity(identityFor(translation))).toEqual([]);
  });

  it("never invents a voice for an uncast speaker", async () => {
    const service = createService();
    const translation = await translate();
    const identity = identityFor(translation);

    expect(await service.listAssignments(identity)).toEqual([]);

    const resolution = await service.resolveCurrent(PROJECT, MEDIA, "pl");

    expect(resolution.state).toBe("voices_required");
    expect(resolution.unassignedSpeakerIds.sort()).toEqual([
      "speaker_1",
      "speaker_2",
    ]);
  });

  it("goes stale when the translated text changes", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);
    await service.run(speechContext(translation).context);

    expect((await service.resolveCurrent(PROJECT, MEDIA, "pl")).state).toBe(
      "ready",
    );

    const target = translation.segments[0];
    await editTranslation(
      translation,
      target.dialogueSegmentId,
      "Zupełnie inne zdanie.",
    );

    const after = await service.resolveCurrent(PROJECT, MEDIA, "pl");
    const view = after.segments.find(
      (segment) => segment.dialogueSegmentId === target.dialogueSegmentId,
    );

    expect(view?.current).toBe(false);
    expect(view?.staleReason).toBe("segment_text_changed");
    // Stale never means deleted: the audio is still there to listen to.
    expect(view?.generated?.artifactId).toEqual(expect.any(String));
  });

  it("goes stale when a speaker's voice changes", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);
    await service.run(speechContext(translation).context);

    await service.assignVoice(
      identityFor(translation),
      "speaker_1",
      VOICE_B,
    );

    const after = await service.resolveCurrent(PROJECT, MEDIA, "pl");
    const recast = after.segments.filter(
      (segment) => segment.speakerId === "speaker_1" && segment.generated,
    );

    expect(recast.length).toBeGreaterThan(0);
    for (const segment of recast) {
      if (segment.generated?.status === "skipped_empty") continue;
      expect(segment.current).toBe(false);
      expect(segment.staleReason).toBe("voice_changed");
    }
  });

  it("regenerates one line without touching the others", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);
    await service.run(speechContext(translation).context);

    const before = await generated.listByIdentity(identityFor(translation));
    const target = before.find(
      (record) => record.status === "completed",
    ) as GeneratedSpeechSegment;
    const others = before.filter((record) => record.id !== target.id);

    await service.run(
      speechContext(translation, {
        operation: "single_segment",
        dialogueSegmentId: target.dialogueSegmentId,
        regenerateAll: true,
      }).context,
    );

    const after = await generated.listByIdentity(identityFor(translation));

    for (const previous of others) {
      const now = after.find((record) => record.id === previous.id);
      // Byte-identical: a single-segment run must not disturb its neighbours.
      expect(now).toEqual(previous);
    }

    const replaced = after.find((record) => record.id === target.id);
    expect(replaced?.status).toBe("completed");
    // The old artifact is released once the new one is safely stored.
    expect(await artifacts.read(target.artifactId as string)).toBeNull();
  });

  it("keeps existing audio when a line fails to generate", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);
    await service.run(speechContext(translation).context);

    const before = await generated.listByIdentity(identityFor(translation));
    const target = before.find(
      (record) => record.status === "completed",
    ) as GeneratedSpeechSegment;

    const failing = createService(failingProvider());
    await failing.run(
      speechContext(translation, {
        operation: "single_segment",
        dialogueSegmentId: target.dialogueSegmentId,
        regenerateAll: true,
      }).context,
    );

    const after = await generated.getBySegment(
      identityFor(translation),
      target.dialogueSegmentId,
    );

    expect(after?.status).toBe("failed");
    // The previous take survives the failure, bytes and all.
    expect(after?.artifactId).toBe(target.artifactId);
    expect(await artifacts.read(target.artifactId as string)).not.toBeNull();
  });

  it("refuses a job built against a translation that has moved on", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);

    await expect(
      service.run(
        speechContext(translation, { translationRevision: 99 }).context,
      ),
    ).rejects.toMatchObject({ code: "TTS_SOURCE_CHANGED" });
  });

  it("refuses to speak a stale translation", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);

    // Editing the dialogue moves it past the revision the translation names.
    const dialogue = await currentDialogue();
    const edit = await editor.applyEdit(PROJECT, MEDIA, {
      type: "update_text",
      segmentId: dialogue.segments[0].id,
      text: "Something else entirely.",
    });

    expect(edit.ok).toBe(true);

    await expect(
      service.run(speechContext(translation).context),
    ).rejects.toMatchObject({ code: "TTS_TRANSLATION_STALE" });
  });

  it("never writes to the translation, dialogue, transcript or diarization", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);

    const beforeTranslation = await translations.getById(translation.id);
    const beforeDialogue = await currentDialogue();
    const beforeTranscript = await transcripts.getById("transcript-a");
    const beforeDiarization = await diarizations.getById("diarization-a");

    await service.run(speechContext(translation).context);

    expect(await translations.getById(translation.id)).toEqual(
      beforeTranslation,
    );
    expect(await currentDialogue()).toEqual(beforeDialogue);
    expect(await transcripts.getById("transcript-a")).toEqual(beforeTranscript);
    expect(await diarizations.getById("diarization-a")).toEqual(
      beforeDiarization,
    );
  });

  it("cancels without storing a partial run", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);

    const controller = new AbortController();
    controller.abort();

    await expect(
      service.run(speechContext(translation, { signal: controller.signal }).context),
    ).rejects.toMatchObject({ code: "CANCELLED" } satisfies Partial<ProcessingError>);

    expect(await generated.listByIdentity(identityFor(translation))).toEqual([]);
  });

  it("skips lines whose audio is already current", async () => {
    const service = createService();
    const translation = await translate();
    await castEveryone(service, translation);
    await service.run(speechContext(translation).context);

    let calls = 0;
    const counting = createService(countingProvider(() => (calls += 1)));

    await counting.run(speechContext(translation).context);

    // Nothing changed, so nothing needed saying again.
    expect(calls).toBe(0);
  });

  it("rejects a voice that cannot speak the target language", async () => {
    const service = createService(englishOnlyProvider());
    const translation = await translate();

    await expect(
      service.assignVoice(identityFor(translation), "speaker_1", {
        type: "standard",
        providerId: "english-only",
        voiceId: "en-1",
      }),
    ).rejects.toMatchObject({ code: "TTS_UNSUPPORTED_LANGUAGE" });
  });
});

function failingProvider(): TtsProvider {
  const mock = new MockTtsProvider();

  return {
    ...mock,
    id: mock.id,
    displayName: mock.displayName,
    capabilities: mock.capabilities,
    isAvailable: () => mock.isAvailable(),
    listVoices: (language?: string) => mock.listVoices(language),
    synthesize: async () => {
      throw new Error("provider exploded");
    },
  };
}

function countingProvider(count: () => void): TtsProvider {
  const mock = new MockTtsProvider();

  return {
    id: mock.id,
    displayName: mock.displayName,
    capabilities: mock.capabilities,
    isAvailable: () => mock.isAvailable(),
    listVoices: (language?: string) => mock.listVoices(language),
    synthesize: (request, context) => {
      count();
      return mock.synthesize(request, context);
    },
  };
}

function englishOnlyProvider(): TtsProvider {
  const mock = new MockTtsProvider();

  return {
    id: "english-only",
    displayName: "English only",
    capabilities: mock.capabilities,
    isAvailable: async () => true,
    listVoices: async () => [
      {
        id: "en-1",
        providerId: "english-only",
        name: "English one",
        languageCodes: ["en"],
        gender: null,
        description: null,
        previewUrl: null,
      },
    ],
    synthesize: (request, context) => mock.synthesize(request, context),
  };
}
