"use client";

import { useState } from "react";

import { formatTimecode, parseTimecode } from "@/lib/timecode";
import { cn } from "@/lib/utils";

/**
 * Corrects a segment's start and end.
 *
 * People type times, not seconds, so the fields accept `00:12.450` and the
 * shorthands around it and parse back to canonical seconds — the formatted
 * string is only ever what is displayed. An unreadable or inconsistent value
 * is reported inline and never committed.
 *
 * When the stored times change underneath — a structural edit, or the other
 * field of this very pair committing on blur — the fields resync, except for
 * the one being typed in. Remounting the whole editor instead would throw away
 * a half-typed second field the moment the first one saved.
 */
export function TimestampEditor({
  startTime,
  endTime,
  mediaDuration,
  onCommit,
}: {
  startTime: number;
  endTime: number;
  mediaDuration: number;
  onCommit: (startTime: number, endTime: number) => void;
}) {
  const [start, setStart] = useState(() => formatTimecode(startTime));
  const [end, setEnd] = useState(() => formatTimecode(endTime));
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<"start" | "end" | null>(null);
  const [stored, setStored] = useState({ startTime, endTime });

  if (stored.startTime !== startTime || stored.endTime !== endTime) {
    setStored({ startTime, endTime });
    if (focused !== "start") setStart(formatTimecode(startTime));
    if (focused !== "end") setEnd(formatTimecode(endTime));
    setError(null);
  }

  function commit() {
    const nextStart = parseTimecode(start);
    const nextEnd = parseTimecode(end);

    if (nextStart === null || nextEnd === null) {
      setError("Use a time like 00:12.450.");
      return;
    }

    if (nextEnd <= nextStart) {
      setError("The end must come after the start.");
      return;
    }

    if (mediaDuration > 0 && nextEnd > mediaDuration + 0.5) {
      setError("A line cannot end after the video does.");
      return;
    }

    setError(null);

    if (nextStart !== startTime || nextEnd !== endTime) {
      onCommit(nextStart, nextEnd);
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <TimeField
          label="Start time"
          value={start}
          invalid={error !== null}
          onChange={setStart}
          onFocus={() => setFocused("start")}
          onRelease={() => setFocused(null)}
          onCommit={commit}
        />
        <span aria-hidden className="text-xs text-muted-foreground">
          →
        </span>
        <TimeField
          label="End time"
          value={end}
          invalid={error !== null}
          onChange={setEnd}
          onFocus={() => setFocused("end")}
          onRelease={() => setFocused(null)}
          onCommit={commit}
        />
      </div>

      {error ? (
        <p role="alert" className="text-[11px] text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function TimeField({
  label,
  value,
  invalid,
  onChange,
  onFocus,
  onRelease,
  onCommit,
}: {
  label: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
  onRelease: () => void;
  onCommit: () => void;
}) {
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={value}
      inputMode="decimal"
      onChange={(event) => onChange(event.target.value)}
      onFocus={onFocus}
      onBlur={() => {
        onCommit();
        onRelease();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit();
        }
      }}
      className={cn(
        "w-24 rounded-md border border-input bg-transparent px-1.5 py-1 font-mono text-[11px] tabular-nums outline-none",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        invalid && "border-destructive",
      )}
    />
  );
}
