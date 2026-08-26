import {
  speakerSpeechSeconds,
  type DiarizedSpeaker,
  type SpeakerRegion,
} from "@/types/diarization";
import { formatDuration } from "@/lib/media/format";

/**
 * Who was heard, and how much. Anonymous clusters only — Aidub does not know,
 * and does not claim to know, who these people are. Naming and voice
 * assignment are later parts.
 */
export function SpeakerSummary({
  speakers,
  regions,
}: {
  speakers: readonly DiarizedSpeaker[];
  regions: readonly SpeakerRegion[];
}) {
  if (speakers.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-wrap gap-2" aria-label="Detected speakers">
      {speakers.map((speaker) => {
        const speakerRegions = regions.filter(
          (region) => region.speakerId === speaker.id,
        );
        const seconds = speakerSpeechSeconds(regions, speaker.id);

        return (
          <li
            key={speaker.id}
            className="flex items-baseline gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5"
          >
            <span className="font-mono text-xs text-foreground">
              {speaker.id}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {speakerRegions.length}{" "}
              {speakerRegions.length === 1 ? "region" : "regions"} ·{" "}
              {formatDuration(seconds)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
