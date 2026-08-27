import { DevelopmentDialogueRepository } from "@/data/dialogue/development-dialogue-repository";
import type { UnifiedDialogueRepository } from "@/data/dialogue/dialogue-repository";

export {
  DialogueStorageError,
  parseStoredDialogue,
  type UnifiedDialogueRepository,
} from "@/data/dialogue/dialogue-repository";
export {
  DevelopmentDialogueRepository,
  DIALOGUE_STORAGE_VERSION,
} from "@/data/dialogue/development-dialogue-repository";

/**
 * The dialogue store the application uses. Pointing this at a database-backed
 * `UnifiedDialogueRepository` is the intended upgrade path and requires no
 * changes to the merge service or the Transcript workspace.
 */
export const dialogueRepository: UnifiedDialogueRepository =
  new DevelopmentDialogueRepository();
