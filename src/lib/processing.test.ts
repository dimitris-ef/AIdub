import { describe, expect, it } from "vitest";

import {
  PROCESSING_JOB_STATUSES,
  type ProcessingJob,
} from "@/types/processing-job";
import {
  describeJobProgress,
  getJobStatusPresentation,
  getJobTypeLabel,
  isJobCancellable,
} from "@/lib/processing";

const job = (overrides: Partial<ProcessingJob> = {}): ProcessingJob => ({
  id: "job-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  type: "extract_audio",
  status: "processing",
  progress: 63,
  indeterminate: false,
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:00.000Z",
  startedAt: null,
  completedAt: null,
  error: null,
  result: null,
  stage: null,
  providerId: null,
  languageHint: null,
  audioArtifactId: null,
  parameters: null,
  ...overrides,
});

describe("job status presentation", () => {
  it("labels every status", () => {
    expect(
      PROCESSING_JOB_STATUSES.map(
        (status) => getJobStatusPresentation(status).label,
      ),
    ).toEqual(["Queued", "Processing", "Completed", "Failed", "Cancelled"]);
  });

  it("degrades gracefully for an unknown status", () => {
    expect(getJobStatusPresentation("exploded").label).toBe("Unknown");
  });

  it("labels job types in product language", () => {
    expect(getJobTypeLabel("probe_media")).toBe("Inspect source");
    expect(getJobTypeLabel("extract_audio")).toBe("Extract audio");
    expect(getJobTypeLabel("convert_media")).toBe("Convert audio");
    expect(getJobTypeLabel("something_else")).toBe("Processing");
  });
});

describe("isJobCancellable", () => {
  it("allows cancelling queued and running jobs only", () => {
    expect(isJobCancellable(job({ status: "queued" }))).toBe(true);
    expect(isJobCancellable(job({ status: "processing" }))).toBe(true);
    expect(isJobCancellable(job({ status: "completed" }))).toBe(false);
    expect(isJobCancellable(job({ status: "failed" }))).toBe(false);
    expect(isJobCancellable(job({ status: "cancelled" }))).toBe(false);
  });
});

describe("describeJobProgress", () => {
  it("shows a percentage while a measurable job runs", () => {
    expect(describeJobProgress(job())).toBe("Processing · 63%");
  });

  it("stays indeterminate rather than inventing a percentage", () => {
    expect(describeJobProgress(job({ indeterminate: true }))).toBe(
      "Processing…",
    );
  });

  it("uses the plain status label outside processing", () => {
    expect(describeJobProgress(job({ status: "completed" }))).toBe("Completed");
    expect(describeJobProgress(job({ status: "failed" }))).toBe("Failed");
  });
});
