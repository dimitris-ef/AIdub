"use client";

import { useEffect, useState } from "react";

import type { UnifiedDialogue } from "@/types/dialogue";
import {
  DialogueRequestError,
  dialogueClient,
  type DialogueClient,
  type DialogueState,
} from "@/services/dialogue/dialogue-client";

export type DialogueLoadStatus = "loading" | "loaded" | "error";

export interface UseDialogueResult {
  status: DialogueLoadStatus;
  /** Why there is no dialogue, when there isn't one. */
  state: DialogueState | null;
  dialogue: UnifiedDialogue | null;
  error: string | null;
  reload: () => void;
}

interface Resolution {
  key: string;
  state: DialogueState;
  dialogue: UnifiedDialogue | null;
  error: string | null;
}

/**
 * Loads the unified dialogue for one source media version.
 *
 * The server generates it lazily on first read and reuses the stored one until
 * its raw inputs change, so this hook never has to know about merging — it
 * asks for the dialogue and gets either one or a reason there isn't one.
 */
export function useDialogue(
  projectId: string | null,
  sourceMediaId: string | null,
  {
    client = dialogueClient,
    /** Changing this refetches — e.g. when transcription or diarization ends. */
    revision = "",
  }: { client?: DialogueClient; revision?: string } = {},
): UseDialogueResult {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const hasTarget = Boolean(projectId && sourceMediaId);
  const key = `${projectId ?? ""}::${sourceMediaId ?? ""}::${revision}::${reloadToken}`;

  useEffect(() => {
    if (!projectId || !sourceMediaId) {
      return;
    }

    let cancelled = false;

    client.getDialogue(projectId, sourceMediaId).then(
      (response) => {
        if (!cancelled) {
          setResolution({
            key,
            state: response.state,
            dialogue: response.dialogue,
            error: null,
          });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setResolution({
            key,
            state: "failed",
            dialogue: null,
            error:
              cause instanceof DialogueRequestError
                ? cause.message
                : "The dialogue could not be loaded.",
          });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [client, key, projectId, sourceMediaId]);

  const isCurrent = resolution?.key === key;

  if (!hasTarget) {
    return {
      status: "loaded",
      state: "transcript_required",
      dialogue: null,
      error: null,
      reload: () => setReloadToken((token) => token + 1),
    };
  }

  return {
    status: isCurrent && resolution ? (resolution.error ? "error" : "loaded") : "loading",
    state: isCurrent && resolution ? resolution.state : null,
    dialogue: isCurrent && resolution ? resolution.dialogue : null,
    error: isCurrent && resolution ? resolution.error : null,
    reload: () => setReloadToken((token) => token + 1),
  };
}
