import { Download } from "lucide-react";

import type {
  ProbeMediaResult,
  ProcessingJobResult,
} from "@/types/processing-job";
import { formatBytes, formatDuration } from "@/lib/media/format";

/**
 * Server-derived results. This is deeper technical inspection than the
 * browser metadata Part 3 shows — it complements it rather than replacing it.
 */
export function ProcessingJobResultDetails({
  result,
  artifactUrl,
}: {
  result: ProcessingJobResult;
  artifactUrl: (artifactId: string) => string;
}) {
  if (!result) {
    return null;
  }

  if (result.kind === "probe_media") {
    return <ProbeDetails metadata={result.metadata} />;
  }

  if (result.kind === "transcribe") {
    return (
      <p className="text-xs text-muted-foreground">
        {result.segmentCount === 0
          ? "No speech was detected in this source."
          : `${result.segmentCount} transcript ${result.segmentCount === 1 ? "segment" : "segments"} · ${result.providerModel ?? result.providerId}`}
      </p>
    );
  }

  if (result.kind === "diarize") {
    return (
      <p className="text-xs text-muted-foreground">
        {result.speakerCount === 0
          ? "No speakers were detected in this source."
          : `${result.speakerCount} ${result.speakerCount === 1 ? "speaker" : "speakers"} · ${result.regionCount} ${result.regionCount === 1 ? "region" : "regions"}`}
      </p>
    );
  }

  const { artifact } = result;
  const parts = [
    "WAV",
    artifact.channels === 1
      ? "Mono"
      : artifact.channels === 2
        ? "Stereo"
        : artifact.channels
          ? `${artifact.channels} ch`
          : null,
    artifact.sampleRate ? `${Math.round(artifact.sampleRate / 1000)} kHz` : null,
    artifact.durationSeconds !== null
      ? formatDuration(artifact.durationSeconds)
      : null,
    formatBytes(artifact.sizeBytes),
  ].filter(Boolean);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{parts.join(" · ")}</span>
      <a
        href={artifactUrl(artifact.id)}
        download={artifact.filename}
        className="inline-flex items-center gap-1 rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Download className="size-3.5" aria-hidden />
        Download
      </a>
    </div>
  );
}

function ProbeDetails({ metadata }: { metadata: ProbeMediaResult }) {
  const rows: { label: string; value: string }[] = [];

  if (metadata.container) {
    rows.push({ label: "Container", value: metadata.container });
  }
  if (metadata.durationSeconds !== null) {
    rows.push({
      label: "Duration",
      value: formatDuration(metadata.durationSeconds),
    });
  }
  if (metadata.video?.codec) {
    rows.push({ label: "Video codec", value: metadata.video.codec });
  }
  if (metadata.video?.width && metadata.video.height) {
    rows.push({
      label: "Resolution",
      value: `${metadata.video.width} × ${metadata.video.height}`,
    });
  }
  if (metadata.video?.frameRate) {
    rows.push({
      label: "Frame rate",
      value: `${metadata.video.frameRate} fps`,
    });
  }
  if (metadata.audio?.codec) {
    rows.push({ label: "Audio codec", value: metadata.audio.codec });
  }
  if (metadata.audio?.sampleRate || metadata.audio?.channels) {
    const audio = [
      metadata.audio.sampleRate
        ? `${Math.round(metadata.audio.sampleRate / 1000)} kHz`
        : null,
      metadata.audio.channels === 1
        ? "mono"
        : metadata.audio.channels === 2
          ? "stereo"
          : metadata.audio.channels
            ? `${metadata.audio.channels} ch`
            : null,
    ].filter(Boolean);

    rows.push({ label: "Audio", value: audio.join(", ") });
  }
  if (!metadata.audio) {
    rows.push({ label: "Audio", value: "No audio stream" });
  }

  if (rows.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No technical metadata could be determined.
      </p>
    );
  }

  return (
    <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="truncate">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
