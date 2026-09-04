import "server-only";

import { DevelopmentArtifactStorage } from "@/server/artifacts/development-artifact-storage";
import { InMemoryProcessingJobRepository } from "@/server/processing/development-job-repository";
import { FfmpegMediaProcessor } from "@/server/processing/ffmpeg-media-processor";
import { UploadedProcessingMediaSource } from "@/server/processing/processing-media-source";
import { ProcessingService } from "@/server/processing/processing-service";
import { LocalTemporaryFileManager } from "@/server/processing/temporary-file-manager";
import { TranscriptionService } from "@/server/transcription/transcription-service";
import { DiarizationService } from "@/server/diarization/diarization-service";
import { TranslationService } from "@/server/translation/translation-service";
import { TtsGenerationService } from "@/server/tts/tts-generation-service";
import { transcriptRepository } from "@/data/transcripts";
import { diarizationRepository } from "@/data/diarization";
import { dialogueRepository } from "@/data/dialogue";
import { translationRepository } from "@/data/translations";
import { generatedSpeechRepository, voiceAssignmentRepository } from "@/data/tts";

/**
 * Server-side wiring. `server-only` keeps this module — and everything it
 * pulls in, including the FFmpeg adapter and `child_process` — out of any
 * browser bundle.
 *
 * The development implementations chosen here (in-memory jobs, temp-directory
 * artifacts, browser-uploaded source bytes, in-process execution) are the only
 * parts a production deployment replaces.
 */

declare global {
  // Next.js reloads modules in development; keep one service per process so
  // job state survives hot reloads within a dev session.
  var __aidubProcessingService: ProcessingService | undefined;
  var __aidubTtsGenerationService: TtsGenerationService | undefined;
}

interface Wiring {
  processing: ProcessingService;
  speech: TtsGenerationService;
}

function createServices(): Wiring {
  // One artifact store, shared. Speech generation writes audio into it and
  // deletes the takes it replaces, while the job layer serves and purges the
  // same records — two instances would each hold half the truth.
  const artifacts = new DevelopmentArtifactStorage();
  const speech = new TtsGenerationService({ artifacts });

  return {
    speech,
    processing: new ProcessingService({
      repository: new InMemoryProcessingJobRepository(),
      processor: new FfmpegMediaProcessor(),
      temporaryFiles: new LocalTemporaryFileManager(),
      artifacts,
      mediaSource: new UploadedProcessingMediaSource(),
      // Independent provider-driven stages sharing one job architecture.
      // Transcription and diarization consume the canonical audio; translation
      // consumes the stored dialogue, and speech consumes the stored
      // translation — neither of the last two touches media at all.
      transcription: new TranscriptionService(),
      diarization: new DiarizationService(),
      translation: new TranslationService(),
      speech,
      transcripts: transcriptRepository,
      diarizations: diarizationRepository,
      dialogues: dialogueRepository,
      translations: translationRepository,
      generatedSpeech: generatedSpeechRepository,
      voiceAssignments: voiceAssignmentRepository,
    }),
  };
}

const wiring: Wiring =
  globalThis.__aidubProcessingService && globalThis.__aidubTtsGenerationService
    ? {
        processing: globalThis.__aidubProcessingService,
        speech: globalThis.__aidubTtsGenerationService,
      }
    : createServices();

export const processingService: ProcessingService = wiring.processing;
export const ttsGenerationService: TtsGenerationService = wiring.speech;

globalThis.__aidubProcessingService = processingService;
globalThis.__aidubTtsGenerationService = ttsGenerationService;
