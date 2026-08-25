import { PROJECT_NAME_MAX_LENGTH } from "@/types/project";
import { isLanguageCode } from "@/lib/languages";

/**
 * Input rules shared by the create/rename dialogs and enforced again by the
 * repository, so invalid data cannot reach storage through another caller.
 */

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateProjectName(rawName: string): ValidationResult {
  const name = rawName.trim();

  if (name.length === 0) {
    return { ok: false, error: "Enter a project name." };
  }
  if (name.length > PROJECT_NAME_MAX_LENGTH) {
    return {
      ok: false,
      error: `Use ${PROJECT_NAME_MAX_LENGTH} characters or fewer.`,
    };
  }

  return { ok: true, value: name };
}

export function validateLanguageSelection(
  sourceLanguage: string,
  targetLanguage: string,
): { ok: true } | { ok: false; error: string } {
  if (!isLanguageCode(sourceLanguage)) {
    return { ok: false, error: "Choose a source language." };
  }
  if (!isLanguageCode(targetLanguage)) {
    return { ok: false, error: "Choose a target language." };
  }
  if (sourceLanguage === targetLanguage) {
    return {
      ok: false,
      error: "Source and target languages must be different.",
    };
  }

  return { ok: true };
}
