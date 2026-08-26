import { DevelopmentTranscriptRepository } from "@/data/transcripts/development-transcript-repository";
import type { TranscriptRepository } from "@/data/transcripts/transcript-repository";

export {
  TranscriptStorageError,
  parseStoredTranscript,
  type TranscriptRepository,
} from "@/data/transcripts/transcript-repository";
export {
  DevelopmentTranscriptRepository,
  TRANSCRIPT_SCHEMA_VERSION,
} from "@/data/transcripts/development-transcript-repository";

/**
 * The transcript store the application uses. Pointing this at a database-backed
 * `TranscriptRepository` is the intended upgrade path and requires no changes
 * to the transcription service or the Transcript workspace.
 */
export const transcriptRepository: TranscriptRepository =
  new DevelopmentTranscriptRepository();
