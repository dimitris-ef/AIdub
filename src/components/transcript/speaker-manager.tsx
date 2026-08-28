"use client";

import { useState } from "react";
import { Check, Merge, PencilLine, X } from "lucide-react";

import type { DialogueSegment, DialogueSpeaker } from "@/types/dialogue";
import { MAX_SPEAKER_NAME_LENGTH } from "@/lib/dialogue/dialogue-edit-operations";
import { speakerToneClasses } from "@/lib/dialogue/speaker-tone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SpeakerSelector } from "@/components/transcript/speaker-selector";

/**
 * Who is in this dialogue, and how to fix it.
 *
 * Renaming changes a display name only — the stable id every line references
 * is untouched — and merging folds one diarization cluster into another when
 * the model split one person in two. Neither touches Part 6's own speaker
 * list. This is not voice assignment: names here are review metadata, nothing
 * more.
 */
export function SpeakerManager({
  speakers,
  segments,
  disabled,
  onRename,
  onMerge,
}: {
  speakers: readonly DialogueSpeaker[];
  segments: readonly DialogueSegment[];
  disabled: boolean;
  onRename: (speakerId: string, name: string) => void;
  onMerge: (sourceSpeakerId: string, targetSpeakerId: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [mergeSource, setMergeSource] = useState<DialogueSpeaker | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);

  if (speakers.length === 0) {
    return null;
  }

  const countFor = (speakerId: string) =>
    segments.filter((segment) => segment.speakerId === speakerId).length;

  const mergeTarget = speakers.find((speaker) => speaker.id === mergeTargetId);

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">Speakers</h4>

      <ul className="flex flex-wrap gap-2" aria-label="Dialogue speakers">
        {speakers.map((speaker) => {
          const count = countFor(speaker.id);
          const tone = speakerToneClasses(speaker.id);

          return (
            <li
              key={speaker.id}
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5"
            >
              <span
                aria-hidden
                className={cn("size-2 shrink-0 rounded-full", tone.accent)}
              />

              {renamingId === speaker.id ? (
                <RenameField
                  initialName={speaker.name}
                  speakerId={speaker.id}
                  onCancel={() => setRenamingId(null)}
                  onSubmit={(name) => {
                    onRename(speaker.id, name);
                    setRenamingId(null);
                  }}
                />
              ) : (
                <>
                  <span className="text-xs font-medium">{speaker.name}</span>
                  <span
                    className="font-mono text-[10px] text-muted-foreground"
                    title="Stable id used by everything downstream"
                  >
                    {speaker.id}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {count} {count === 1 ? "line" : "lines"}
                  </span>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5 text-[11px]"
                    disabled={disabled}
                    aria-label={`Rename ${speaker.name}`}
                    onClick={() => setRenamingId(speaker.id)}
                  >
                    <PencilLine aria-hidden />
                  </Button>

                  {speakers.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[11px]"
                      disabled={disabled}
                      aria-label={`Merge ${speaker.name} into another speaker`}
                      onClick={() => {
                        setMergeSource(speaker);
                        setMergeTargetId(
                          speakers.find((other) => other.id !== speaker.id)
                            ?.id ?? null,
                        );
                      }}
                    >
                      <Merge aria-hidden />
                    </Button>
                  ) : null}
                </>
              )}
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={mergeSource !== null}
        onOpenChange={(open) => {
          if (!open) setMergeSource(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge speakers</AlertDialogTitle>
            <AlertDialogDescription>
              {mergeSource && mergeTarget ? (
                <>
                  All dialogue currently assigned to{" "}
                  <strong>{mergeSource.name}</strong> will be reassigned to{" "}
                  <strong>{mergeTarget.name}</strong>, which keeps its id{" "}
                  <code>{mergeTarget.id}</code>. The speaker analysis itself is
                  not changed — only this dialogue.
                </>
              ) : (
                "Choose a speaker to merge into."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-1.5">
            <label
              htmlFor="merge-target"
              className="text-xs font-medium text-muted-foreground"
            >
              Merge into
            </label>
            <div id="merge-target">
              <SpeakerSelector
                speakers={speakers.filter(
                  (speaker) => speaker.id !== mergeSource?.id,
                )}
                value={mergeTargetId}
                label="Speaker to merge into"
                onChange={setMergeTargetId}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                disabled ||
                !mergeSource ||
                !mergeTargetId ||
                mergeTargetId === mergeSource.id
              }
              onClick={() => {
                if (mergeSource && mergeTargetId) {
                  onMerge(mergeSource.id, mergeTargetId);
                }
                setMergeSource(null);
              }}
            >
              Merge speakers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RenameField({
  initialName,
  speakerId,
  onCancel,
  onSubmit,
}: {
  initialName: string;
  speakerId: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);

  return (
    <span className="flex items-center gap-1">
      <Input
        autoFocus
        value={name}
        maxLength={MAX_SPEAKER_NAME_LENGTH}
        aria-label={`Name for ${speakerId}`}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit(name);
          }
          if (event.key === "Escape") {
            onCancel();
          }
        }}
        className="h-7 w-36 text-xs"
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        aria-label="Save speaker name"
        onClick={() => onSubmit(name)}
      >
        <Check aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5"
        aria-label="Cancel rename"
        onClick={onCancel}
      >
        <X aria-hidden />
      </Button>
    </span>
  );
}
