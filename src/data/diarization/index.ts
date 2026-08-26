import { DevelopmentDiarizationRepository } from "@/data/diarization/development-diarization-repository";
import type { DiarizationRepository } from "@/data/diarization/diarization-repository";

export {
  DiarizationStorageError,
  parseStoredDiarization,
  type DiarizationRepository,
} from "@/data/diarization/diarization-repository";
export {
  DevelopmentDiarizationRepository,
  DIARIZATION_SCHEMA_VERSION,
} from "@/data/diarization/development-diarization-repository";

/**
 * The diarization store the application uses. Pointing this at a
 * database-backed `DiarizationRepository` is the intended upgrade path and
 * requires no changes to the diarization service or the workspace.
 */
export const diarizationRepository: DiarizationRepository =
  new DevelopmentDiarizationRepository();
