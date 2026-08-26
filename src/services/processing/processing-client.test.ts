import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProcessingJob } from "@/types/processing-job";
import {
  HttpProcessingClient,
  ProcessingRequestError,
  parseProcessingJob,
} from "@/services/processing/processing-client";

const job: ProcessingJob = {
  id: "job-1",
  projectId: "project-1",
  sourceMediaId: "media-1",
  type: "extract_audio",
  status: "processing",
  progress: 42,
  indeterminate: false,
  createdAt: "2026-08-25T10:00:00.000Z",
  updatedAt: "2026-08-25T10:00:05.000Z",
  startedAt: "2026-08-25T10:00:01.000Z",
  completedAt: null,
  error: null,
  result: null,
  stage: null,
  providerId: null,
  languageHint: null,
  audioArtifactId: null,
};

function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  );

  vi.stubGlobal("fetch", spy);

  return spy;
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("parseProcessingJob", () => {
  it("accepts a well-formed job and fills optional fields", () => {
    const parsed = parseProcessingJob({
      id: "job-1",
      projectId: "project-1",
      sourceMediaId: "media-1",
      type: "probe_media",
      status: "queued",
      progress: 0,
      createdAt: "2026-08-25T10:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    });

    expect(parsed).toMatchObject({
      indeterminate: false,
      startedAt: null,
      completedAt: null,
      error: null,
      result: null,
    });
  });

  it.each([
    ["null", null],
    ["a missing id", { ...job, id: undefined }],
    ["an unknown type", { ...job, type: "diarize" }],
    ["an unknown status", { ...job, status: "paused" }],
    ["a non-numeric progress", { ...job, progress: "42" }],
  ])("rejects %s", (_label, value) => {
    expect(() => parseProcessingJob(value)).toThrowError(
      ProcessingRequestError,
    );
  });
});

describe("HttpProcessingClient", () => {
  const client = new HttpProcessingClient();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a job as multipart with the source attached", async () => {
    let capturedBody: FormData | undefined;
    const fetchSpy = mockFetch((_url, init) => {
      capturedBody = init?.body as FormData;
      return jsonResponse({ job: { ...job, status: "queued", progress: 0 } }, 201);
    });

    const created = await client.createJob({
      projectId: "project-1",
      sourceMediaId: "media-1",
      type: "extract_audio",
      source: new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" }),
      sourceFilename: "clip.mp4",
    });

    expect(created.status).toBe("queued");
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/processing/jobs");
    expect(capturedBody?.get("projectId")).toBe("project-1");
    expect(capturedBody?.get("sourceMediaId")).toBe("media-1");
    expect(capturedBody?.get("type")).toBe("extract_audio");
    expect(capturedBody?.get("source")).toBeInstanceOf(File);
  });

  it("scopes job reads to the project", async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ job }));

    await client.getJob("job-1", "project-1");

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/processing/jobs/job-1?projectId=project-1",
    );
  });

  it("cancels through the job's cancel route", async () => {
    const fetchSpy = mockFetch(() =>
      jsonResponse({ job: { ...job, status: "cancelled" } }),
    );

    const cancelled = await client.cancelJob("job-1", "project-1");

    expect(cancelled.status).toBe("cancelled");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/processing/jobs/job-1/cancel?projectId=project-1",
    );
    expect(fetchSpy.mock.calls[0][1]?.method).toBe("POST");
  });

  it("lists jobs for a project and source media", async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ jobs: [job] }));

    const jobs = await client.listJobs("project-1", "media-1");

    expect(jobs).toHaveLength(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "/api/processing/jobs?projectId=project-1&mediaId=media-1",
    );
  });

  it("returns an empty list when the response has no jobs", async () => {
    mockFetch(() => jsonResponse({}));

    await expect(client.listJobs("project-1")).resolves.toEqual([]);
  });

  it("purges a scope with DELETE", async () => {
    const fetchSpy = mockFetch(() => jsonResponse({ cancelled: 2 }));

    await client.purge("project-1", "media-1");

    expect(fetchSpy.mock.calls[0][1]?.method).toBe("DELETE");
    expect(fetchSpy.mock.calls[0][0]).toContain("mediaId=media-1");
  });

  it("reads backend capabilities", async () => {
    mockFetch(() =>
      jsonResponse({
        capabilities: { ffmpegAvailable: true, ffprobeAvailable: false },
      }),
    );

    await expect(client.getCapabilities()).resolves.toEqual({
      ffmpegAvailable: true,
      ffprobeAvailable: false,
    });
  });

  it("surfaces the backend's structured error message", async () => {
    mockFetch(() =>
      jsonResponse(
        {
          error: {
            code: "NO_AUDIO_STREAM",
            message: "No audio track was found in this source video.",
          },
        },
        400,
      ),
    );

    await expect(
      client.getJob("job-1", "project-1"),
    ).rejects.toMatchObject({
      code: "NO_AUDIO_STREAM",
      message: "No audio track was found in this source video.",
    });
  });

  it("falls back to a safe message for a non-JSON failure", async () => {
    mockFetch(() => new Response("<html>502</html>", { status: 502 }));

    await expect(client.getJob("job-1", "project-1")).rejects.toMatchObject({
      message: "The processing service is unavailable.",
    });
  });

  it("builds a project-scoped artifact URL", () => {
    expect(client.artifactUrl("artifact-1", "project-1")).toBe(
      "/api/processing/artifacts/artifact-1?projectId=project-1",
    );
  });
});
