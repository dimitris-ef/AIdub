import type { ProjectMedia } from "@/types/media";
import {
  formatBytes,
  formatDuration,
  formatResolution,
} from "@/lib/media/format";

/**
 * Metadata for the stored source video. Values come from the media record, so
 * the canonical numbers stay in the model and only their display is formatted
 * here. The filename is rendered as text — never as markup.
 */
export function SourceVideoDetails({ media }: { media: ProjectMedia }) {
  const rows: { label: string; value: string; title?: string }[] = [
    { label: "Filename", value: media.filename, title: media.filename },
    { label: "Duration", value: formatDuration(media.durationSeconds) },
    { label: "Resolution", value: formatResolution(media.width, media.height) },
    { label: "File size", value: formatBytes(media.sizeBytes) },
    { label: "Format", value: media.container ?? "Unknown" },
  ];

  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(({ label, value, title }) => (
        <div key={label} className="min-w-0 space-y-0.5">
          <dt className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </dt>
          <dd className="truncate text-sm" title={title}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
