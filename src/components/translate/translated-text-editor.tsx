"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Inline editing for one translated line.
 *
 * Commits on blur rather than on every keystroke — one persisted correction per
 * edit, not one per character — which is the same bargain the Transcript editor
 * makes and for the same reason: each save is a server round trip that
 * revalidates and recomputes the duration estimate.
 *
 * It follows the stored text only while it is **not** focused. A regeneration
 * or someone else's save landing mid-sentence must not yank the words out from
 * under the person typing them.
 */
export function TranslatedTextEditor({
  value,
  label,
  disabled,
  onCommit,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onCommit: (text: string) => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setText(value);
    }
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={text}
      disabled={disabled}
      aria-label={label}
      rows={Math.max(2, Math.ceil(text.length / 80))}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text !== value) {
          onCommit(text);
        }
      }}
      className="w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 text-sm leading-6 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
    />
  );
}
