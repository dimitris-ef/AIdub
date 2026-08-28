"use client";

import { useEffect, useState } from "react";

import type { DialogueTranslation } from "@/types/translation";
import {
  TranslationRequestError,
  translationClient,
  type TranslationClient,
  type TranslationDialogueSummary,
  type TranslationState,
} from "@/services/translation/translation-client";

export type TranslationLoadStatus = "loading" | "loaded" | "error";

export interface UseTranslationResult {
  status: TranslationLoadStatus;
  /** Why there is no current translation, when there isn't one. */
  state: TranslationState | null;
  translation: DialogueTranslation | null;
  /** The dialogue the answer was resolved against. */
  dialogue: TranslationDialogueSummary | null;
  /** Set when a stored translation exists but no longer matches. */
  staleReason: string | undefined;
  error: string | null;
  reload: () => void;
}

interface Resolution {
  key: string;
  state: TranslationState;
  translation: DialogueTranslation | null;
  dialogue: TranslationDialogueSummary | null;
  staleReason: string | undefined;
  error: string | null;
}

/**
 * Loads the stored translation for one source and language pair.
 *
 * Reading never triggers translation: a completed translation is reused for as
 * long as it stays current, and producing a new one is always something a
 * person asks for. That matters more here than elsewhere in Aidub — a
 * translation costs provider credits, so an automatic refresh would quietly
 * spend money.
 */
export function useTranslation(
  projectId: string | null,
  sourceMediaId: string | null,
  languages: { sourceLanguage: string; targetLanguage: string } | null,
  {
    client = translationClient,
    /** Changing this refetches — e.g. when a translate job completes. */
    revision = "",
  }: { client?: TranslationClient; revision?: string } = {},
): UseTranslationResult {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const sourceLanguage = languages?.sourceLanguage ?? null;
  const targetLanguage = languages?.targetLanguage ?? null;
  const hasTarget = Boolean(
    projectId && sourceMediaId && sourceLanguage && targetLanguage,
  );
  // The language pair is part of the key: changing the project's target
  // language asks a different question and must not reuse the old answer.
  const key = `${projectId ?? ""}::${sourceMediaId ?? ""}::${sourceLanguage ?? ""}::${targetLanguage ?? ""}::${revision}::${reloadToken}`;

  useEffect(() => {
    if (!projectId || !sourceMediaId || !sourceLanguage || !targetLanguage) {
      return;
    }

    let cancelled = false;

    client
      .getTranslation(projectId, sourceMediaId, {
        sourceLanguage,
        targetLanguage,
      })
      .then(
        (response) => {
          if (!cancelled) {
            setResolution({
              key,
              state: response.state,
              translation: response.translation,
              dialogue: response.dialogue,
              staleReason: response.staleReason,
              error: null,
            });
          }
        },
        (cause: unknown) => {
          if (!cancelled) {
            setResolution({
              key,
              state: "not_translated",
              translation: null,
              dialogue: null,
              staleReason: undefined,
              error:
                cause instanceof TranslationRequestError
                  ? cause.message
                  : "The translation could not be loaded.",
            });
          }
        },
      );

    return () => {
      cancelled = true;
    };
  }, [client, key, projectId, sourceMediaId, sourceLanguage, targetLanguage]);

  const isCurrent = resolution?.key === key;
  const reload = () => setReloadToken((token) => token + 1);

  if (!hasTarget) {
    return {
      status: "loaded",
      state: "dialogue_required",
      translation: null,
      dialogue: null,
      staleReason: undefined,
      error: null,
      reload,
    };
  }

  return {
    status:
      isCurrent && resolution
        ? resolution.error
          ? "error"
          : "loaded"
        : "loading",
    state: isCurrent && resolution ? resolution.state : null,
    translation: isCurrent && resolution ? resolution.translation : null,
    dialogue: isCurrent && resolution ? resolution.dialogue : null,
    staleReason: isCurrent && resolution ? resolution.staleReason : undefined,
    error: isCurrent && resolution ? resolution.error : null,
    reload,
  };
}
