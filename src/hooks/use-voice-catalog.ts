"use client";

import { useEffect, useState } from "react";

import type { TtsVoice } from "@/types/tts";
import { ttsClient, type TtsClient } from "@/services/tts/tts-client";

export interface UseVoiceCatalogResult {
  status: "loading" | "loaded" | "error";
  /** False when no speech provider is configured on this server. */
  available: boolean;
  providerId: string | null;
  voices: TtsVoice[];
  error: string | null;
}

/**
 * The voices this server can speak the target language with.
 *
 * Loaded once per language rather than per speaker: every speaker picks from
 * the same catalog, and fetching it once means opening the cast list does not
 * fan out one request per character.
 */
export function useVoiceCatalog(
  targetLanguage: string | null,
  { client = ttsClient }: { client?: TtsClient } = {},
): UseVoiceCatalogResult {
  const [state, setState] = useState<{
    key: string;
    available: boolean;
    providerId: string | null;
    voices: TtsVoice[];
    error: string | null;
  } | null>(null);

  const key = targetLanguage ?? "";

  useEffect(() => {
    if (!targetLanguage) {
      return;
    }

    let cancelled = false;

    client.getVoices(targetLanguage).then(
      (catalog) => {
        if (!cancelled) {
          setState({
            key,
            available: catalog.available,
            providerId: catalog.providerId,
            voices: catalog.voices,
            error: null,
          });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setState({
            key,
            available: false,
            providerId: null,
            voices: [],
            error:
              cause instanceof Error
                ? cause.message
                : "The available voices could not be loaded.",
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [client, key, targetLanguage]);

  const fresh = state?.key === key ? state : null;

  return {
    status: !targetLanguage
      ? "loaded"
      : fresh
        ? fresh.error
          ? "error"
          : "loaded"
        : "loading",
    available: fresh?.available ?? false,
    providerId: fresh?.providerId ?? null,
    voices: fresh?.voices ?? [],
    error: fresh?.error ?? null,
  };
}
