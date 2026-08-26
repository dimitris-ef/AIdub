"use client";

import type { ProcessingJob } from "@/types/processing-job";
import { StageJobStatus } from "@/components/processing/stage-job-status";

/**
 * Live state of a transcription job. The job UI itself is shared with every
 * other provider-driven stage — transcription does not get its own system.
 */
export function TranscriptionStatus({
  job,
  onCancel,
}: {
  job: ProcessingJob;
  onCancel: () => void;
}) {
  return (
    <StageJobStatus
      job={job}
      title="Transcribing source audio"
      onCancel={onCancel}
    />
  );
}
