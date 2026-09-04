import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type {
  GeneratedSpeechSegment,
  SpeakerVoiceAssignment,
} from "@/types/tts";
import { DEFAULT_TTS_SETTINGS } from "@/types/tts";
import { TTS_SCHEMA_VERSION } from "@/lib/tts/tts-config";
import { DevelopmentGeneratedSpeechRepository } from "@/data/tts/development-generated-speech-repository";
import { DevelopmentVoiceAssignmentRepository } from "@/data/tts/development-voice-assignment-repository";
import {
  generatedSpeechId,
  parseStoredGeneratedSpeech,
} from "@/data/tts/generated-speech-repository";
import {
  parseStoredVoiceAssignment,
  voiceAssignmentId,
} from "@/data/tts/voice-assignment-repository";

/**
 * The TTS stores.
 *
 * Development storage is a directory of JSON a person can edit and a platform
 * can truncate, so nothing is trusted on read. These tests pin what happens to
 * a record that cannot be understood — and, for assignments, that the answer is
 * never "invent a plausible one", because a casting decision cannot be
 * recomputed from anything.
 */

const IDENTITY = {
  projectId: "project-a",
  sourceMediaId: "media-a",
  dialogueId: "dialogue-a",
  targetLanguage: "pl",
};

function assignment(
  overrides: Partial<SpeakerVoiceAssignment> = {},
): SpeakerVoiceAssignment {
  return {
    id: voiceAssignmentId(IDENTITY, "speaker_1"),
    projectId: IDENTITY.projectId,
    sourceMediaId: IDENTITY.sourceMediaId,
    dialogueId: IDENTITY.dialogueId,
    speakerId: "speaker_1",
    voice: { type: "standard", providerId: "prov", voiceId: "voice-a" },
    targetLanguage: "pl",
    settings: { ...DEFAULT_TTS_SETTINGS },
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

function speech(
  overrides: Partial<GeneratedSpeechSegment> = {},
): GeneratedSpeechSegment {
  return {
    id: generatedSpeechId(IDENTITY, "seg-1"),
    projectId: IDENTITY.projectId,
    sourceMediaId: IDENTITY.sourceMediaId,
    dialogueId: IDENTITY.dialogueId,
    dialogueSegmentId: "seg-1",
    speakerId: "speaker_1",
    translationId: "tr-1",
    translationRevision: 1,
    translatedSegmentRevision: 1,
    targetLanguage: "pl",
    providerId: "prov",
    providerModel: "model-x",
    voiceId: "voice-a",
    artifactId: "artifact-1",
    mimeType: "audio/wav",
    status: "completed",
    durationSeconds: 1.2,
    segmentDurationSeconds: 2,
    generationSettings: { ...DEFAULT_TTS_SETTINGS },
    warnings: [],
    fingerprint: "fp-1",
    version: TTS_SCHEMA_VERSION,
    createdAt: "2026-08-28T10:00:00.000Z",
    updatedAt: "2026-08-28T10:00:00.000Z",
    usage: null,
    ...overrides,
  };
}

describe("DevelopmentVoiceAssignmentRepository", () => {
  let root: string;
  let repository: DevelopmentVoiceAssignmentRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-assignments-"));
    repository = new DevelopmentVoiceAssignmentRepository(root);
  });

  it("stores and reads back one assignment per speaker", async () => {
    await repository.save(assignment());
    await repository.save(
      assignment({
        id: voiceAssignmentId(IDENTITY, "speaker_2"),
        speakerId: "speaker_2",
        voice: { type: "standard", providerId: "prov", voiceId: "voice-b" },
      }),
    );

    expect(await repository.listByIdentity(IDENTITY)).toHaveLength(2);
    expect(
      (await repository.getBySpeaker(IDENTITY, "speaker_2"))?.voice.voiceId,
    ).toBe("voice-b");
  });

  it("replaces rather than accumulates when a speaker is recast", async () => {
    await repository.save(assignment());
    await repository.save(
      assignment({
        voice: { type: "standard", providerId: "prov", voiceId: "voice-z" },
      }),
    );

    const stored = await repository.listByIdentity(IDENTITY);

    // A deterministic id means there is never a set of rival assignments whose
    // winner depends on a timestamp.
    expect(stored).toHaveLength(1);
    expect(stored[0].voice.voiceId).toBe("voice-z");
  });

  it("keeps assignments for different languages apart", async () => {
    await repository.save(assignment());
    await repository.save(
      assignment({
        id: voiceAssignmentId({ ...IDENTITY, targetLanguage: "fr" }, "speaker_1"),
        targetLanguage: "fr",
        voice: { type: "standard", providerId: "prov", voiceId: "voice-fr" },
      }),
    );

    expect(await repository.listByIdentity(IDENTITY)).toHaveLength(1);
    expect(
      await repository.listByIdentity({ ...IDENTITY, targetLanguage: "fr" }),
    ).toHaveLength(1);
  });

  it("skips an unreadable record rather than inventing a voice", async () => {
    await repository.save(assignment());
    await writeFile(
      path.join(root, IDENTITY.projectId, "broken.json"),
      "{ not json",
      "utf8",
    );
    await writeFile(
      path.join(root, IDENTITY.projectId, "no-voice.json"),
      JSON.stringify({ ...assignment({ id: "no-voice" }), voice: null }),
      "utf8",
    );

    // Two bad files, one good one, and nothing guessed to fill the gaps: the
    // workspace shows those speakers as uncast and asks.
    expect(await repository.listByIdentity(IDENTITY)).toHaveLength(1);
  });

  it("rejects a voice source shape it does not understand", () => {
    expect(
      parseStoredVoiceAssignment({
        ...assignment(),
        // A Part 12 cloned voice written by a newer build must not load as a
        // standard one and be spoken in the wrong voice.
        voice: { type: "cloned", providerId: "prov", voiceId: "v" },
      }),
    ).toBeNull();
  });

  it("removes assignments by media and by project", async () => {
    await repository.save(assignment());
    await repository.deleteByMedia(IDENTITY.projectId, "other-media");
    expect(await repository.listByIdentity(IDENTITY)).toHaveLength(1);

    await repository.deleteByMedia(IDENTITY.projectId, IDENTITY.sourceMediaId);
    expect(await repository.listByIdentity(IDENTITY)).toEqual([]);

    await repository.save(assignment());
    await repository.deleteByProject(IDENTITY.projectId);
    expect(await repository.listByIdentity(IDENTITY)).toEqual([]);
  });
});

describe("DevelopmentGeneratedSpeechRepository", () => {
  let root: string;
  let repository: DevelopmentGeneratedSpeechRepository;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "aidub-generated-"));
    repository = new DevelopmentGeneratedSpeechRepository(root);
  });

  it("stores one record per line and replaces on regeneration", async () => {
    await repository.saveAll([speech(), speech({ id: generatedSpeechId(IDENTITY, "seg-2"), dialogueSegmentId: "seg-2" })]);
    await repository.save(speech({ durationSeconds: 9.9 }));

    const stored = await repository.listByIdentity(IDENTITY);

    expect(stored).toHaveLength(2);
    expect(
      (await repository.getBySegment(IDENTITY, "seg-1"))?.durationSeconds,
    ).toBe(9.9);
  });

  it("reads a record whose audio is gone as a record with no audio", async () => {
    await repository.save(speech({ artifactId: null, status: "failed" }));

    const stored = await repository.getBySegment(IDENTITY, "seg-1");

    // Development artifacts live in a temp directory the OS may reclaim, so a
    // record outliving its bytes is expected — and must not crash a read.
    expect(stored?.artifactId).toBeNull();
    expect(stored?.status).toBe("failed");
  });

  it("treats an unversioned record as older than the current schema", () => {
    const record = parseStoredGeneratedSpeech({
      ...speech(),
      version: undefined,
    });

    // Defaulting to the current version would let pre-versioning audio pass
    // the staleness check and be served as current.
    expect(record?.version).toBeLessThan(TTS_SCHEMA_VERSION);
  });

  it("drops usage that measured nothing", () => {
    expect(parseStoredGeneratedSpeech({ ...speech(), usage: {} })?.usage).toBeNull();
    expect(
      parseStoredGeneratedSpeech({ ...speech(), usage: { characters: 12 } })
        ?.usage,
    ).toEqual({ characters: 12 });
  });

  it("skips a record missing the ids everything joins on", () => {
    for (const missing of [
      "dialogueSegmentId",
      "translationId",
      "fingerprint",
      "voiceId",
    ] as const) {
      expect(
        parseStoredGeneratedSpeech({ ...speech(), [missing]: "" }),
      ).toBeNull();
    }
  });

  it("removes records by media and by project", async () => {
    await repository.save(speech());
    await repository.deleteByMedia(IDENTITY.projectId, IDENTITY.sourceMediaId);
    expect(await repository.listByIdentity(IDENTITY)).toEqual([]);

    await repository.save(speech());
    await repository.deleteByProject(IDENTITY.projectId);
    expect(await repository.listByIdentity(IDENTITY)).toEqual([]);
  });
});
