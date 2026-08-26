"use client";

import { useEffect, useState } from "react";

import type { Transcript } from "@/types/transcript";
import {
  TranscriptRequestError,
  transcriptClient,
  type TranscriptClient,
} from "@/services/transcription/transcript-client";

export type TranscriptLoadStatus =
  | "loading"
  | "none"
  | "loaded"
  | "error";

export interface UseTranscriptResult {
  status: TranscriptLoadStatus;
  transcript: Transcript | null;
  error: string | null;
  reload: () => void;
}

interface Resolution {
  key: string;
  status: Exclude<TranscriptLoadStatus, "loading">;
  transcript: Transcript | null;
  error: string | null;
}

/**
 * Loads the persisted transcript for one source media version.
 *
 * Reopening a project reads the stored transcript instead of transcribing
 * again, and "no transcript yet" is only shown after the lookup finishes —
 * never while it is still in flight.
 */
export function useTranscript(
  projectId: string | null,
  sourceMediaId: string | null,
  {
    client = transcriptClient,
    /** Changing this refetches — e.g. when a transcription job completes. */
    revision = "",
  }: { client?: TranscriptClient; revision?: string } = {},
): UseTranscriptResult {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const hasTarget = Boolean(projectId && sourceMediaId);
  const key = `${projectId ?? ""}::${sourceMediaId ?? ""}::${revision}::${reloadToken}`;

  useEffect(() => {
    if (!projectId || !sourceMediaId) {
      return;
    }

    let cancelled = false;

    client.getTranscript(projectId, sourceMediaId).then(
      (transcript) => {
        if (!cancelled) {
          setResolution({
            key,
            status: transcript ? "loaded" : "none",
            transcript,
            error: null,
          });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setResolution({
            key,
            status: "error",
            transcript: null,
            error:
              cause instanceof TranscriptRequestError
                ? cause.message
                : "The transcript could not be loaded.",
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [client, key, projectId, sourceMediaId]);

  const isCurrent = resolution?.key === key;

  return {
    status: !hasTarget ? "none" : isCurrent && resolution ? resolution.status : "loading",
    transcript: isCurrent && resolution ? resolution.transcript : null,
    error: isCurrent && resolution ? resolution.error : null,
    reload: () => setReloadToken((token) => token + 1),
  };
}
