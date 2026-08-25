import { writeFile } from "node:fs/promises";

import { ProcessingError } from "@/server/processing/processing-errors";

/**
 * The bridge between "where the source video lives" and "where processing can
 * read it".
 *
 * Part 3 keeps source media in the browser, which server code cannot read, so
 * the development implementation writes the bytes the browser uploaded with
 * the job request into the job's temporary directory. That upload is a
 * **development transport, not a storage architecture**: in production the
 * backend resolves `sourceMediaId` to object storage (or a signed URL) and
 * streams it to the worker, with no browser round-trip — and the job model,
 * API contract and UI stay exactly the same.
 */

export interface MaterializeSourceRequest {
  projectId: string;
  sourceMediaId: string;
  targetPath: string;
  /** Development transport: bytes supplied by the browser with the request. */
  uploadedSource?: {
    bytes: Uint8Array;
    filename: string;
  };
}

export interface ProcessingMediaSource {
  materializeSource(request: MaterializeSourceRequest): Promise<void>;
}

/** Writes the uploaded bytes into the job workspace. Development only. */
export class UploadedProcessingMediaSource implements ProcessingMediaSource {
  async materializeSource(request: MaterializeSourceRequest): Promise<void> {
    const uploaded = request.uploadedSource;

    if (!uploaded || uploaded.bytes.byteLength === 0) {
      throw new ProcessingError(
        "SOURCE_MEDIA_NOT_FOUND",
        "The source media could not be read for processing.",
      );
    }

    try {
      await writeFile(request.targetPath, uploaded.bytes);
    } catch (cause) {
      throw new ProcessingError(
        "TEMP_STORAGE_ERROR",
        "The source media could not be prepared for processing.",
        { cause },
      );
    }
  }
}
