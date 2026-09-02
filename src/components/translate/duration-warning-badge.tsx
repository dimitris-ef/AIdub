import { AlertTriangle, Check, Clock } from "lucide-react";

import type { DubbingTranslationMetadata } from "@/types/translation";
import {
  DURATION_WARNING_LABELS,
  type TranslationDurationWarning,
} from "@/lib/translation/duration-warning";
import { cn } from "@/lib/utils";

/**
 * How well a translated line is likely to fit the time it has.
 *
 * Deliberately hedged: it reads "Estimated 6.2s / 4.0s" rather than a
 * confident-looking single number, because that is what it is — an estimate
 * from text, made before anything has been synthesised. Overstating it would
 * invite people to trust a timing claim Aidub cannot yet make.
 *
 * The level is carried by an icon and a word as well as a colour, so it is
 * legible without relying on hue.
 */

const TONES: Record<TranslationDurationWarning, string> = {
  none: "border-border bg-muted/50 text-muted-foreground",
  slightly_long: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  likely_too_long: "border-destructive/50 bg-destructive/10 text-destructive",
};

const ICONS: Record<TranslationDurationWarning, typeof Clock> = {
  none: Check,
  slightly_long: Clock,
  likely_too_long: AlertTriangle,
};

function formatSeconds(value: number): string {
  return `${value.toFixed(1)}s`;
}

export function DurationWarningBadge({
  metadata,
}: {
  metadata: DubbingTranslationMetadata;
}) {
  const { durationWarning, estimatedDurationSeconds, sourceDurationSeconds } =
    metadata;

  // Nothing to compare — an empty line, or a segment with no usable duration.
  // Saying "Fits" here would be a claim rather than an absence of one.
  if (estimatedDurationSeconds === null || sourceDurationSeconds <= 0) {
    return null;
  }

  const Icon = ICONS[durationWarning];

  return (
    <span
      data-duration-warning={durationWarning}
      title={`Estimated from the text, not from generated speech (estimator ${metadata.durationEstimatorVersion})`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums",
        TONES[durationWarning],
      )}
    >
      <Icon className="size-3" aria-hidden />
      <span>
        Estimated {formatSeconds(estimatedDurationSeconds)} /{" "}
        {formatSeconds(sourceDurationSeconds)}
      </span>
      {durationWarning === "none" ? null : (
        <span>· {DURATION_WARNING_LABELS[durationWarning]}</span>
      )}
    </span>
  );
}
