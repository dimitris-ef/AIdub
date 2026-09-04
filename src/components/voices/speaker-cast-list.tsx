"use client";

import { useRef, useState } from "react";
import { Loader2, Play, UserRound } from "lucide-react";

import type { DialogueSpeaker } from "@/types/dialogue";
import { speakerDisplayName } from "@/types/dialogue";
import type { SpeakerVoiceAssignment, TtsVoice } from "@/types/tts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The cast list: which voice speaks for each character.
 *
 * Every voice here is chosen by a person. Aidub never picks one from anything
 * it inferred about a speaker — not from the audio, the name, the diarization
 * or the transcript — because those inferences are guesses about people, and a
 * casting decision is not something to guess at. The list is the same for every
 * speaker; the only thing that differs is what someone chose after listening.
 *
 * Preview plays a fixed neutral sentence rather than the character's own lines:
 * an audition is about hearing the voice, and it should never be mistakable for
 * a generated take.
 */
export function SpeakerCastList({
  speakers,
  voices,
  assignments,
  lineCounts,
  busy,
  pendingSpeakerId,
  onAssign,
  onPreview,
}: {
  speakers: readonly DialogueSpeaker[];
  voices: readonly TtsVoice[];
  assignments: readonly SpeakerVoiceAssignment[];
  /** How many spoken lines each speaker has, for ordering and context. */
  lineCounts: ReadonlyMap<string, number>;
  busy: boolean;
  pendingSpeakerId: string | null;
  onAssign: (speakerId: string, voiceId: string) => void;
  onPreview: (voiceId: string) => Promise<string | null>;
}) {
  const bySpeaker = new Map(
    assignments.map((assignment) => [assignment.speakerId, assignment]),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold tracking-tight">Cast</h3>
        <p className="text-xs text-muted-foreground">
          {assignments.length} of {speakers.length} assigned
        </p>
      </div>

      <ul className="divide-y divide-border rounded-lg border border-border">
        {speakers.map((speaker) => (
          <li
            key={speaker.id}
            className="flex flex-wrap items-center gap-3 p-3"
          >
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground"
            >
              <UserRound className="size-4" />
            </span>

            <div className="min-w-32 flex-1">
              <p className="text-sm font-medium">
                {speakerDisplayName(speakers, speaker.id)}
              </p>
              <p className="text-xs text-muted-foreground">
                {lineCounts.get(speaker.id) ?? 0}{" "}
                {(lineCounts.get(speaker.id) ?? 0) === 1 ? "line" : "lines"}
              </p>
            </div>

            <VoicePicker
              speakerId={speaker.id}
              speakerName={speakerDisplayName(speakers, speaker.id)}
              voices={voices}
              value={bySpeaker.get(speaker.id)?.voice.voiceId ?? null}
              busy={busy || pendingSpeakerId === speaker.id}
              onAssign={onAssign}
              onPreview={onPreview}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function VoicePicker({
  speakerId,
  speakerName,
  voices,
  value,
  busy,
  onAssign,
  onPreview,
}: {
  speakerId: string;
  speakerName: string;
  voices: readonly TtsVoice[];
  value: string | null;
  busy: boolean;
  onAssign: (speakerId: string, voiceId: string) => void;
  onPreview: (voiceId: string) => Promise<string | null>;
}) {
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const selectId = `voice-${speakerId}`;

  async function preview() {
    if (!value) {
      return;
    }

    setPreviewing(true);

    try {
      const url = await onPreview(value);

      if (!url) {
        return;
      }

      // Object URLs are ephemeral: the previous one is released before a new
      // one replaces it, so auditioning a dozen voices leaks nothing.
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
      }

      urlRef.current = url;
      audioRef.current ??= new Audio();
      audioRef.current.src = url;
      await audioRef.current.play();
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={selectId} className="sr-only">
        Voice for {speakerName}
      </Label>
      <Select
        value={value ?? undefined}
        disabled={busy || voices.length === 0}
        onValueChange={(voiceId) => onAssign(speakerId, voiceId)}
      >
        <SelectTrigger id={selectId} className="w-56">
          <SelectValue placeholder="Choose a voice" />
        </SelectTrigger>
        <SelectContent>
          {voices.map((voice) => (
            <SelectItem key={voice.id} value={voice.id}>
              {voice.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Button
        size="sm"
        variant="ghost"
        disabled={!value || previewing || busy}
        onClick={() => void preview()}
        aria-label={`Preview the voice for ${speakerName}`}
      >
        {previewing ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <Play aria-hidden />
        )}
      </Button>
    </div>
  );
}
