import { DevelopmentTranslationRepository } from "@/data/translations/development-translation-repository";
import type { TranslationRepository } from "@/data/translations/translation-repository";

export {
  TranslationStorageError,
  parseStoredTranslation,
  matchesIdentity,
  newestFirst,
  type TranslationRepository,
} from "@/data/translations/translation-repository";
export {
  DevelopmentTranslationRepository,
  TRANSLATION_STORAGE_VERSION,
} from "@/data/translations/development-translation-repository";

/**
 * The translation store the application uses. Pointing this at a
 * database-backed `TranslationRepository` is the intended upgrade path and
 * requires no changes to the translation service or the Translate workspace.
 */
export const translationRepository: TranslationRepository =
  new DevelopmentTranslationRepository();
