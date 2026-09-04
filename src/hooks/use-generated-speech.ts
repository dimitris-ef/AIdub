"use client";

import { useCallback, useEffect, useState } from "react";

import {
  ttsClient,
  type SpeechResponse,
  type TtsClient,
} from "@/services/tts/tts-client";

export type SpeechLoadStatus = "loading" | "loaded" | "error";

export interface UseGeneratedSpeechResult {
  status: SpeechLoadStatus;
  speech: SpeechResponse | null;
  error: string | null;
  reload: () => void;
}

/**
 * Loads the generated speech for one source and target language.
 *
 * Reading never triggers generation: synthesis costs provider credits and
 * minutes, so producing audio is always something a person asks for. The same
 * rule Part 9 applies to translation, for the same reason.
 */
export function useGeneratedSpeech(
  projectId: string | null,
  sourceMediaId: string | null,
  targetLanguage: string | null,
  {
    client = ttsClient,
    /** Changing this refetches — e.g. when a generate_speech job completes. */
    revision = "",
  }: { client?: TtsClient; revision?: string } = {},
): UseGeneratedSpeechResult {
  const [state, setState] = useState<{
    key: string;
    speech: SpeechResponse | null;
    error: string | null;
  } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const ready = Boolean(projectId && sourceMediaId && targetLanguage);
  // The language is part of the key: changing the project's target language
  // asks a different question and must not reuse the old answer.
  const key = `${projectId ?? ""}::${sourceMediaId ?? ""}::${targetLanguage ?? ""}::${revision}::${reloadToken}`;

  useEffect(() => {
    if (!projectId || !sourceMediaId || !targetLanguage) {
      return;
    }

    let cancelled = false;

    client.getSpeech(projectId, sourceMediaId, targetLanguage).then(
      (speech) => {
        if (!cancelled) {
          setState({ key, speech, error: null });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setState({
            key,
            speech: null,
            error:
              cause instanceof Error
                ? cause.message
                : "The generated speech could not be loaded.",
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [client, key, projectId, sourceMediaId, targetLanguage]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  // Comparing against the key rather than clearing state on change: the old
  // answer stays visible until the new one arrives, instead of the workspace
  // blanking every time a job finishes.
  const fresh = state?.key === key ? state : null;

  return {
    status: !ready ? "loaded" : fresh ? (fresh.error ? "error" : "loaded") : "loading",
    speech: fresh?.speech ?? null,
    error: fresh?.error ?? null,
    reload,
  };
}
