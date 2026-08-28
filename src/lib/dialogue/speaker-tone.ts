/**
 * Visual tones for speakers, in one place so the transcript and the timeline
 * always agree about who is who.
 *
 * Colour is a secondary cue only: every speaker is also named in text
 * everywhere it appears, so the interface stays usable without relying on
 * distinguishing hues. Tones come from the design tokens rather than raw
 * colours, and are assigned deterministically from the canonical speaker id so
 * they stay stable across renders, reloads and sessions.
 */

export interface SpeakerTone {
  /** Timeline block. */
  block: string;
  /** Small transcript accent. */
  accent: string;
}

const TONES: SpeakerTone[] = [
  { block: "border-speaker-1/60 bg-speaker-1/25", accent: "bg-speaker-1" },
  { block: "border-speaker-2/60 bg-speaker-2/25", accent: "bg-speaker-2" },
  { block: "border-speaker-3/60 bg-speaker-3/25", accent: "bg-speaker-3" },
  { block: "border-speaker-4/60 bg-speaker-4/25", accent: "bg-speaker-4" },
  { block: "border-speaker-5/60 bg-speaker-5/25", accent: "bg-speaker-5" },
];

const UNASSIGNED: SpeakerTone = {
  block: "border-dashed border-border bg-muted/60",
  accent: "bg-muted-foreground/40",
};

export function speakerToneClasses(speakerId: string | null): SpeakerTone {
  if (!speakerId) {
    return UNASSIGNED;
  }

  // A stable hash of the id, so a speaker keeps its tone regardless of the
  // order speakers happen to be listed in.
  let hash = 0;
  for (let index = 0; index < speakerId.length; index += 1) {
    hash = (hash * 31 + speakerId.charCodeAt(index)) >>> 0;
  }

  return TONES[hash % TONES.length];
}
