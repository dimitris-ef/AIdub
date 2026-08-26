"use client";

import { useEffect, useState } from "react";

import type { DiarizationResult } from "@/types/diarization";
import {
  DiarizationRequestError,
  diarizationClient,
  type DiarizationClient,
} from "@/services/diarization/diarization-client";

export type DiarizationLoadStatus = "loading" | "none" | "loaded" | "error";

export interface UseDiarizationResult {
  status: DiarizationLoadStatus;
  diarization: DiarizationResult | null;
  error: string | null;
  reload: () => void;
}

interface Resolution {
  key: string;
  status: Exclude<DiarizationLoadStatus, "loading">;
  diarization: DiarizationResult | null;
  error: string | null;
}

/**
 * Loads the persisted diarization for one source media version.
 *
 * Reopening a project reads the stored result — including its speaker and
 * region ids — instead of rerunning the model, and "not analysed yet" is only
 * shown once the lookup finishes, never while it is still in flight.
 */
export function useDiarization(
  projectId: string | null,
  sourceMediaId: string | null,
  {
    client = diarizationClient,
    /** Changing this refetches — e.g. when a diarization job completes. */
    revision = "",
  }: { client?: DiarizationClient; revision?: string } = {},
): UseDiarizationResult {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const hasTarget = Boolean(projectId && sourceMediaId);
  const key = `${projectId ?? ""}::${sourceMediaId ?? ""}::${revision}::${reloadToken}`;

  useEffect(() => {
    if (!projectId || !sourceMediaId) {
      return;
    }

    let cancelled = false;

    client.getDiarization(projectId, sourceMediaId).then(
      (diarization) => {
        if (!cancelled) {
          setResolution({
            key,
            status: diarization ? "loaded" : "none",
            diarization,
            error: null,
          });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setResolution({
            key,
            status: "error",
            diarization: null,
            error:
              cause instanceof DiarizationRequestError
                ? cause.message
                : "The speaker analysis could not be loaded.",
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
    status: !hasTarget
      ? "none"
      : isCurrent && resolution
        ? resolution.status
        : "loading",
    diarization: isCurrent && resolution ? resolution.diarization : null,
    error: isCurrent && resolution ? resolution.error : null,
    reload: () => setReloadToken((token) => token + 1),
  };
}
