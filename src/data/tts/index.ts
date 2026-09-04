import { DevelopmentGeneratedSpeechRepository } from "@/data/tts/development-generated-speech-repository";
import { DevelopmentVoiceAssignmentRepository } from "@/data/tts/development-voice-assignment-repository";
import type { GeneratedSpeechRepository } from "@/data/tts/generated-speech-repository";
import type { VoiceAssignmentRepository } from "@/data/tts/voice-assignment-repository";

export {
  GeneratedSpeechStorageError,
  generatedSpeechId,
  matchesGeneratedSpeechIdentity,
  parseStoredGeneratedSpeech,
  type GeneratedSpeechIdentity,
  type GeneratedSpeechRepository,
} from "@/data/tts/generated-speech-repository";
export {
  VoiceAssignmentStorageError,
  matchesVoiceIdentity,
  parseStoredVoiceAssignment,
  voiceAssignmentId,
  type VoiceAssignmentIdentity,
  type VoiceAssignmentRepository,
} from "@/data/tts/voice-assignment-repository";
export {
  DevelopmentGeneratedSpeechRepository,
  GENERATED_SPEECH_STORAGE_VERSION,
} from "@/data/tts/development-generated-speech-repository";
export {
  DevelopmentVoiceAssignmentRepository,
  VOICE_ASSIGNMENT_STORAGE_VERSION,
} from "@/data/tts/development-voice-assignment-repository";

/**
 * The TTS stores the application uses.
 *
 * Two separate repositories rather than one, because they have genuinely
 * different lifecycles: assignments are authored once and kept, generated audio
 * is derived and replaced constantly. Pointing either at a database-backed
 * implementation is the intended upgrade path and requires no changes to the
 * generation service or the Voices workspace.
 */
export const voiceAssignmentRepository: VoiceAssignmentRepository =
  new DevelopmentVoiceAssignmentRepository();

export const generatedSpeechRepository: GeneratedSpeechRepository =
  new DevelopmentGeneratedSpeechRepository();
