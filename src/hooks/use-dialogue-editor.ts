"use client";

import { useCallback, useRef, useState } from "react";

import type { UnifiedDialogue } from "@/types/dialogue";
import {
  DialogueRequestError,
  dialogueClient,
  type DialogueClient,
  type DialogueEdit,
} from "@/services/dialogue/dialogue-client";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseDialogueEditorResult {
  dialogue: UnifiedDialogue | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  /** Segments that a timing edit has just pushed into a new overlap. */
  newOverlaps: string[];
  applyEdit: (edit: DialogueEdit) => Promise<boolean>;
  dismissError: () => void;
}

/**
 * Owns the editable dialogue while the workspace is open.
 *
 * Every correction is applied server-side against the stored document and the
 * saved result replaces local state, so what is on screen is always what was
 * actually persisted. A failed save leaves the previous document in place and
 * surfaces the error rather than pretending the change landed — with structural
 * edits especially, showing a split that was never stored would be worse than
 * showing nothing.
 */
export function useDialogueEditor(
  projectId: string,
  sourceMediaId: string | null,
  loaded: UnifiedDialogue | null,
  { client = dialogueClient }: { client?: DialogueClient } = {},
): UseDialogueEditorResult {
  const [edited, setEdited] = useState<UnifiedDialogue | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newOverlaps, setNewOverlaps] = useState<string[]>([]);
  const inFlight = useRef(0);

  // The freshly loaded document wins until an edit produces a newer one for
  // the same dialogue; that keeps a refetch from resurrecting stale content.
  const dialogue =
    edited && loaded && edited.id === loaded.id
      ? edited.editMetadata.revision >= loaded.editMetadata.revision
        ? edited
        : loaded
      : loaded;

  const applyEdit = useCallback(
    async (edit: DialogueEdit) => {
      if (!sourceMediaId) {
        return false;
      }

      const ticket = ++inFlight.current;
      setSaveStatus("saving");
      setSaveError(null);

      try {
        const response = await client.applyEdit(
          projectId,
          sourceMediaId,
          edit,
        );

        // A slower earlier edit must not overwrite a newer one.
        if (ticket === inFlight.current) {
          setEdited(response.dialogue);
          setNewOverlaps(response.newOverlaps);
          setSaveStatus("saved");
        }

        return true;
      } catch (cause) {
        if (ticket === inFlight.current) {
          setSaveStatus("error");
          setSaveError(
            cause instanceof DialogueRequestError
              ? cause.message
              : "The change could not be saved.",
          );
        }

        return false;
      }
    },
    [client, projectId, sourceMediaId],
  );

  return {
    dialogue,
    saveStatus,
    saveError,
    newOverlaps,
    applyEdit,
    dismissError: () => {
      setSaveStatus("idle");
      setSaveError(null);
    },
  };
}
