"use client";

import { useCallback, useRef, useState } from "react";

import type { DialogueTranslation } from "@/types/translation";
import {
  TranslationRequestError,
  translationClient,
  type TranslationClient,
} from "@/services/translation/translation-client";

export type TranslationSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseTranslationEditorResult {
  translation: DialogueTranslation | null;
  saveStatus: TranslationSaveStatus;
  saveError: string | null;
  /** The line currently being saved, if any. */
  savingSegmentId: string | null;
  editSegment: (segmentId: string, translatedText: string) => Promise<boolean>;
  dismissError: () => void;
}

/**
 * Owns the editable translation while the workspace is open.
 *
 * Every edit is applied server-side against the stored record and the saved
 * result replaces local state, so what is on screen is what was actually
 * persisted — including the recomputed duration estimate, which the client
 * never calculates for itself.
 *
 * A failed save keeps the previous document and says so. That matters more here
 * than almost anywhere else in Aidub: the alternative is a person believing
 * their rewrite of a line was kept when it was not.
 */
export function useTranslationEditor(
  projectId: string | null,
  sourceMediaId: string | null,
  languages: { sourceLanguage: string; targetLanguage: string } | null,
  loaded: DialogueTranslation | null,
  { client = translationClient }: { client?: TranslationClient } = {},
): UseTranslationEditorResult {
  const [edited, setEdited] = useState<DialogueTranslation | null>(null);
  const [saveStatus, setSaveStatus] = useState<TranslationSaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingSegmentId, setSavingSegmentId] = useState<string | null>(null);
  const inFlight = useRef(0);

  // The freshly loaded document wins until an edit produces a newer one for the
  // same translation; that keeps a refetch from resurrecting stale content.
  const translation =
    edited && loaded && edited.id === loaded.id
      ? edited.revision >= loaded.revision
        ? edited
        : loaded
      : loaded;

  const editSegment = useCallback(
    async (segmentId: string, translatedText: string) => {
      if (!projectId || !sourceMediaId || !languages || !translation) {
        return false;
      }

      const ticket = ++inFlight.current;
      setSaveStatus("saving");
      setSaveError(null);
      setSavingSegmentId(segmentId);

      try {
        const saved = await client.editSegment(
          projectId,
          sourceMediaId,
          languages,
          {
            segmentId,
            translatedText,
            // The revision this edit was composed against: the server refuses
            // the write if the translation has moved on since.
            expectedRevision: translation.revision,
          },
        );

        // A slower earlier edit must not overwrite a newer one.
        if (ticket === inFlight.current) {
          setEdited(saved);
          setSaveStatus("saved");
        }

        return true;
      } catch (cause) {
        if (ticket === inFlight.current) {
          setSaveStatus("error");
          setSaveError(
            cause instanceof TranslationRequestError
              ? cause.message
              : "The change could not be saved.",
          );
        }

        return false;
      } finally {
        if (ticket === inFlight.current) {
          setSavingSegmentId(null);
        }
      }
    },
    [client, languages, projectId, sourceMediaId, translation],
  );

  return {
    translation,
    saveStatus,
    saveError,
    savingSegmentId,
    editSegment,
    dismissError: () => {
      setSaveStatus("idle");
      setSaveError(null);
    },
  };
}
