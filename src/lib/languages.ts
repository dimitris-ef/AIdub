export interface LanguageOption {
  /** BCP 47 primary subtag. */
  code: string;
  label: string;
}

/**
 * The single source of truth for language metadata. In Part 2 languages are
 * metadata only — nothing is translated.
 */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "el", label: "Greek" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

export const DEFAULT_SOURCE_LANGUAGE = "en";
export const DEFAULT_TARGET_LANGUAGE = "es";

const LANGUAGE_BY_CODE = new Map(
  LANGUAGES.map((language) => [language.code, language]),
);

export function isLanguageCode(value: unknown): value is string {
  return typeof value === "string" && LANGUAGE_BY_CODE.has(value);
}

/** Falls back to the raw code so unknown data renders instead of crashing. */
export function getLanguageLabel(code: string): string {
  return LANGUAGE_BY_CODE.get(code)?.label ?? code;
}

/** "English → Polish" */
export function formatLanguagePair(
  sourceLanguage: string,
  targetLanguage: string,
): string {
  return `${getLanguageLabel(sourceLanguage)} → ${getLanguageLabel(targetLanguage)}`;
}
