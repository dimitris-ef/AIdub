"use client";

import type { DialogueSpeaker } from "@/types/dialogue";

/** Sentinel for "no speaker", since a select value cannot be null. */
export const UNASSIGNED_VALUE = "__unassigned__";

/**
 * Reassigns a line to another speaker, or to nobody.
 *
 * A native select on purpose: it is compact enough to sit on every row, it is
 * keyboard and screen-reader accessible without extra work, and reassignment
 * is the single most repeated action in transcript review.
 */
export function SpeakerSelector({
  speakers,
  value,
  label,
  onChange,
}: {
  speakers: readonly DialogueSpeaker[];
  value: string | null;
  label: string;
  onChange: (speakerId: string | null) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? UNASSIGNED_VALUE}
      onChange={(event) =>
        onChange(
          event.target.value === UNASSIGNED_VALUE ? null : event.target.value,
        )
      }
      className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {speakers.map((speaker) => (
        <option key={speaker.id} value={speaker.id}>
          {speaker.name}
        </option>
      ))}
      <option value={UNASSIGNED_VALUE}>Unassigned</option>
    </select>
  );
}
