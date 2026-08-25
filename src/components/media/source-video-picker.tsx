"use client";

import { useId, useRef, useState, type ReactNode } from "react";

import { SOURCE_VIDEO_ACCEPT } from "@/lib/media/container";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Keyboard-accessible wrapper around `input[type="file"]`. The input stays in
 * the accessibility tree (visually hidden, not `display: none`) and is driven
 * by a real button, so the picker is reachable by keyboard and screen readers.
 *
 * `accept` is only a hint to the file dialog — every selection is still
 * validated by the media service before anything is stored.
 */
export function SourceVideoPicker({
  label,
  inputLabel,
  onSelect,
  disabled,
  variant = "default",
  size = "default",
  icon,
  className,
}: {
  /** Visible button text; may change while an action is running. */
  label: string;
  /** Stable accessible name for the file input. Defaults to `label`. */
  inputLabel?: string;
  onSelect: (file: File) => void;
  disabled?: boolean;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg";
  icon?: ReactNode;
  className?: string;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        id={inputId}
        ref={inputRef}
        type="file"
        accept={SOURCE_VIDEO_ACCEPT}
        aria-label={inputLabel ?? label}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so selecting the same file again still fires a change event.
          event.target.value = "";
          if (file) {
            onSelect(file);
          }
        }}
      />
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => inputRef.current?.click()}
      >
        {icon}
        {label}
      </Button>
    </>
  );
}

/**
 * Optional drag-and-drop surface. It is never the only way to import: the
 * picker button inside it always works.
 */
export function SourceVideoDropzone({
  onSelect,
  disabled,
  children,
  className,
}: {
  onSelect: (file: File) => void;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <div
      data-dragging={isDragging || undefined}
      className={cn(
        "rounded-lg border border-dashed border-border bg-card/30 transition-colors",
        "data-[dragging]:border-primary/60 data-[dragging]:bg-primary/5",
        className,
      )}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        // Ignore drags moving between child elements.
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setIsDragging(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setIsDragging(false);

        const file = event.dataTransfer.files?.[0];
        if (file) {
          onSelect(file);
        }
      }}
    >
      {children}
    </div>
  );
}
