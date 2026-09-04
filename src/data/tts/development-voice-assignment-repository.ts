import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SpeakerVoiceAssignment } from "@/types/tts";
import { defaultTempRoot } from "@/server/processing/temporary-file-manager";
import {
  matchesVoiceIdentity,
  parseStoredVoiceAssignment,
  voiceAssignmentId,
  VoiceAssignmentStorageError,
  type VoiceAssignmentIdentity,
  type VoiceAssignmentRepository,
} from "@/data/tts/voice-assignment-repository";

/**
 * Development voice-assignment persistence: one JSON file per assignment under
 * `<os temp>/aidub/voice-assignments/v1/<projectId>/<assignmentId>.json`.
 *
 * The same convention as Parts 5–10, and server-side for the same reason: a
 * provider credential must never reach the browser, so the server owns
 * everything a provider call is built from. The file name is the deterministic
 * `voiceAssignmentId`, so re-casting a speaker overwrites one file rather than
 * leaving two records to disagree.
 *
 * Limitations, deliberately accepted: this is the OS temp directory, so the
 * platform may reclaim it, and it is local to one machine. Production replaces
 * it with a database behind the same interface — and of everything Part 11
 * stores, this is the record that most wants a real one, because a lost casting
 * decision cannot be recomputed.
 */

export const VOICE_ASSIGNMENT_STORAGE_VERSION = "v1";
export const VOICE_ASSIGNMENTS_DIRECTORY_NAME = "voice-assignments";

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function assertSafeSegment(value: string): string {
  if (!SAFE_SEGMENT.test(value) || value === "." || value === "..") {
    throw new VoiceAssignmentStorageError("Invalid voice assignment identifier.");
  }

  return value;
}

export class DevelopmentVoiceAssignmentRepository
  implements VoiceAssignmentRepository
{
  constructor(
    private readonly rootDirectory: string = path.join(
      defaultTempRoot(),
      VOICE_ASSIGNMENTS_DIRECTORY_NAME,
      VOICE_ASSIGNMENT_STORAGE_VERSION,
    ),
  ) {}

  private projectDirectory(projectId: string): string {
    return path.join(this.rootDirectory, assertSafeSegment(projectId));
  }

  private assignmentPath(projectId: string, assignmentId: string): string {
    return path.join(
      this.projectDirectory(projectId),
      `${assertSafeSegment(assignmentId)}.json`,
    );
  }

  async save(
    assignment: SpeakerVoiceAssignment,
  ): Promise<SpeakerVoiceAssignment> {
    try {
      await mkdir(this.projectDirectory(assignment.projectId), {
        recursive: true,
      });
      await writeFile(
        this.assignmentPath(assignment.projectId, assignment.id),
        JSON.stringify(assignment, null, 2),
        "utf8",
      );
    } catch (cause) {
      throw new VoiceAssignmentStorageError(
        "The voice assignment could not be saved.",
        { cause },
      );
    }

    return assignment;
  }

  async listByIdentity(
    identity: VoiceAssignmentIdentity,
  ): Promise<SpeakerVoiceAssignment[]> {
    return (await this.readProject(identity.projectId))
      .filter((assignment) => matchesVoiceIdentity(assignment, identity))
      .sort((a, b) => (a.speakerId < b.speakerId ? -1 : 1));
  }

  async getBySpeaker(
    identity: VoiceAssignmentIdentity,
    speakerId: string,
  ): Promise<SpeakerVoiceAssignment | null> {
    const assignments = await this.listByIdentity(identity);

    return (
      assignments.find((assignment) => assignment.speakerId === speakerId) ??
      null
    );
  }

  async delete(
    identity: VoiceAssignmentIdentity,
    speakerId: string,
  ): Promise<void> {
    await rm(
      this.assignmentPath(
        identity.projectId,
        voiceAssignmentId(identity, speakerId),
      ),
      { force: true },
    );
  }

  async deleteByMedia(
    projectId: string,
    sourceMediaId: string,
  ): Promise<void> {
    for (const assignment of await this.readProject(projectId)) {
      if (assignment.sourceMediaId === sourceMediaId) {
        await rm(this.assignmentPath(projectId, assignment.id), {
          force: true,
        });
      }
    }
  }

  async deleteByProject(projectId: string): Promise<void> {
    await rm(this.projectDirectory(projectId), {
      recursive: true,
      force: true,
    });
  }

  private async readProject(
    projectId: string,
  ): Promise<SpeakerVoiceAssignment[]> {
    let files: string[];

    try {
      files = await readdir(this.projectDirectory(projectId));
    } catch {
      return [];
    }

    const assignments: SpeakerVoiceAssignment[] = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await readFile(
          path.join(this.projectDirectory(projectId), file),
          "utf8",
        );
        const parsed = parseStoredVoiceAssignment(JSON.parse(raw));

        if (parsed && parsed.projectId === projectId) {
          assignments.push(parsed);
        }
      } catch {
        continue;
      }
    }

    return assignments;
  }
}
