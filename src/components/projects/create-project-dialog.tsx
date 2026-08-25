"use client";

import { useState } from "react";

import type { CreateProjectInput } from "@/types/project";
import {
  DEFAULT_SOURCE_LANGUAGE,
  DEFAULT_TARGET_LANGUAGE,
} from "@/lib/languages";
import {
  validateLanguageSelection,
  validateProjectName,
} from "@/lib/project-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  LanguageField,
  ProjectNameField,
} from "@/components/projects/project-form-fields";

/**
 * Owns the creation form and its validation only. Persistence, ids and
 * timestamps belong to the repository behind `onCreate`.
 */
export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: CreateProjectInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState(DEFAULT_SOURCE_LANGUAGE);
  const [targetLanguage, setTargetLanguage] = useState(DEFAULT_TARGET_LANGUAGE);
  const [nameError, setNameError] = useState<string>();
  const [languageError, setLanguageError] = useState<string>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setName("");
    setSourceLanguage(DEFAULT_SOURCE_LANGUAGE);
    setTargetLanguage(DEFAULT_TARGET_LANGUAGE);
    setNameError(undefined);
    setLanguageError(undefined);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && isSubmitting) {
      return;
    }
    if (!nextOpen) {
      reset();
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nameResult = validateProjectName(name);
    const languageResult = validateLanguageSelection(
      sourceLanguage,
      targetLanguage,
    );

    setNameError(nameResult.ok ? undefined : nameResult.error);
    setLanguageError(languageResult.ok ? undefined : languageResult.error);

    if (!nameResult.ok || !languageResult.ok) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreate({
        name: nameResult.value,
        sourceLanguage,
        targetLanguage,
      });
      reset();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            Name the project and choose the language pair. Media, transcript and
            voices are added in later parts.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <ProjectNameField
            value={name}
            onChange={(value) => {
              setName(value);
              if (nameError) setNameError(undefined);
            }}
            error={nameError}
            autoFocus
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <LanguageField
              label="Source language"
              value={sourceLanguage}
              onChange={(value) => {
                setSourceLanguage(value);
                if (languageError) setLanguageError(undefined);
              }}
            />
            <LanguageField
              label="Target language"
              value={targetLanguage}
              onChange={(value) => {
                setTargetLanguage(value);
                if (languageError) setLanguageError(undefined);
              }}
            />
          </div>

          {languageError ? (
            <p role="alert" className="text-xs text-destructive">
              {languageError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
