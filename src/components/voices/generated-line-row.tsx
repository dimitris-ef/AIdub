"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";

import { formatTimecode } from "@/lib/timecode";
import { TTS_WARNING_LABELS } from "@/lib/tts/generated-duration";
import { GENERATED_SPEECH_STALE_MESSAGES } from "@/lib/tts/tts-staleness";
import type { SpeechSegmentView } from "@/services/tts/tts-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * One dubbed line.
 *
 * Three things are shown together on purpose: the translated text, how long the
 * generated speech actually is, and how long the original line had. Reading
 * them side by side is how someone judges whether a line will work — and the
 * only thing Part 11 does about a line that runs long is say so. Nothing here
 * stretches audio, compresses it, adjusts a rate or moves a timestamp.
 *
 * "Play original" plays the source video at this line's position on the shared
 * player; "Play dubbed" plays the synthesised audio. Comparing them is the whole
 * point of this screen, so both are one click from the same row.
 */
export function GeneratedLineRow({
  segment,
  speakerName,
  selected,
  busy,
  generating,
  audioUrl,
  onSelect,
  onPlayOriginal,
  onRegenerate,
}: {
  segment: SpeechSegmentView;
  speakerName: string | null;
  selected: boolean;
  busy: boolean;
  generating: boolean;
  audioUrl: string | null;
  onSelect: () => void;
  onPlayOriginal: () => void;
  onRegenerate: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const generated = segment.generated;

  useEffect(() => {
    // A regenerated line reuses its URL, so the element has to be rebuilt
    // rather than left holding the take it already buffered.
    const element = audioRef.current;

    return () => {
      element?.pause();
    };
  }, [audioUrl]);

  function toggleGenerated() {
    if (!audioUrl) {
      return;
    }

    const element = (audioRef.current ??= new Audio());

    if (playing) {
      element.pause();
      setPlaying(false);
      return;
    }

    element.src = audioUrl;
    element.onended = () => setPlaying(false);
    element.onpause = () => setPlaying(false);
    void element.play().then(
      () => setPlaying(true),
      () => setPlaying(false),
    );
  }

  const ratio =
    generated?.durationSeconds && segment.segmentDurationSeconds > 0
      ? generated.durationSeconds / segment.segmentDurationSeconds
      : null;

  return (
    <li data-segment-id={segment.dialogueSegmentId}>
      <div
        className={cn(
          "flex flex-col gap-2 border-l-2 p-3 transition-colors",
          selected
            ? "border-l-primary bg-accent/40"
            : "border-l-transparent hover:bg-accent/20",
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-left"
        >
          <span className="font-mono text-xs text-muted-foreground">
            {formatTimecode(segment.startTime)}
          </span>
          {speakerName ? (
            <span className="text-xs font-medium">{speakerName}</span>
          ) : (
            <span className="text-xs text-muted-foreground">No speaker</span>
          )}
          <span className="w-full text-sm">
            {segment.translatedText.trim().length > 0 ? (
              segment.translatedText
            ) : (
              <em className="text-muted-foreground">No spoken text</em>
            )}
          </span>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onPlayOriginal}>
            <Play aria-hidden />
            Play original
          </Button>

          {generated?.status === "completed" && audioUrl ? (
            <Button size="sm" variant="ghost" onClick={toggleGenerated}>
              {playing ? <Square aria-hidden /> : <Play aria-hidden />}
              {playing ? "Stop" : "Play dubbed"}
            </Button>
          ) : null}

          <Button
            size="sm"
            variant="ghost"
            // A line with no speaker has no voice, and one with no text has
            // nothing to say. The backend refuses both, so the button does not
            // offer them.
            disabled={
              busy ||
              generating ||
              segment.speakerId === null ||
              segment.translatedText.trim().length === 0
            }
            onClick={onRegenerate}
          >
            {generating ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : (
              <RotateCcw aria-hidden />
            )}
            {generated ? "Regenerate" : "Generate"}
          </Button>

          <DurationComparison
            generatedSeconds={generated?.durationSeconds ?? null}
            availableSeconds={segment.segmentDurationSeconds}
            ratio={ratio}
          />
        </div>

        {generated?.status === "skipped_empty" ? (
          <p className="text-xs text-muted-foreground">
            Intentionally silent — this line has nothing to speak.
          </p>
        ) : null}

        {generated?.status === "failed" ? (
          <p role="alert" className="text-xs text-destructive">
            The last attempt to generate this line failed.
            {generated.artifactId
              ? " The previous audio is still available above."
              : ""}
          </p>
        ) : null}

        {generated?.warnings.map((warning) => (
          <p
            key={warning}
            className="flex items-start gap-1.5 text-xs text-muted-foreground"
          >
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>{TTS_WARNING_LABELS[warning]}</span>
          </p>
        ))}

        {generated && !segment.current && segment.staleReason ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
            <span>
              {GENERATED_SPEECH_STALE_MESSAGES[segment.staleReason]} The audio is
              kept — regenerate this line to bring it up to date.
            </span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

/**
 * Generated length against available length.
 *
 * Shown as both durations plus their ratio, rather than a single verdict: a
 * person deciding whether to shorten a line needs the numbers, and "1.4×" says
 * something a red dot does not.
 */
function DurationComparison({
  generatedSeconds,
  availableSeconds,
  ratio,
}: {
  generatedSeconds: number | null;
  availableSeconds: number;
  ratio: number | null;
}) {
  if (generatedSeconds === null) {
    return null;
  }

  return (
    <span className="font-mono text-xs text-muted-foreground">
      {generatedSeconds.toFixed(1)}s / {availableSeconds.toFixed(1)}s
      {ratio ? ` · ${ratio.toFixed(2)}×` : ""}
    </span>
  );
}
