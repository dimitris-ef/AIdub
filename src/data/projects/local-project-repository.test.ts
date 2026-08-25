import { beforeEach, describe, expect, it } from "vitest";

import {
  LocalProjectRepository,
  PROJECTS_STORAGE_KEY,
  parseStoredProject,
  type KeyValueStorage,
} from "@/data/projects/local-project-repository";
import {
  ProjectNotFoundError,
  ProjectValidationError,
  sortProjectsByRecency,
} from "@/data/projects/project-repository";
import type { Project } from "@/types/project";

class MemoryStorage implements KeyValueStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }
}

/** Deterministic clock and ids keep the tests exact. */
function createRepository() {
  const storage = new MemoryStorage();
  let idCounter = 0;
  let clock = Date.parse("2026-08-25T10:00:00.000Z");

  const repository = new LocalProjectRepository({
    storage,
    createId: () => `id-${++idCounter}`,
    now: () => new Date(clock),
  });

  return {
    repository,
    storage,
    advance(ms: number) {
      clock += ms;
    },
    stored(): unknown {
      const raw = storage.getItem(PROJECTS_STORAGE_KEY);
      return raw === null ? null : JSON.parse(raw);
    },
  };
}

const validInput = {
  name: "Travel Documentary",
  sourceLanguage: "en",
  targetLanguage: "pl",
};

describe("LocalProjectRepository", () => {
  let context: ReturnType<typeof createRepository>;

  beforeEach(() => {
    context = createRepository();
  });

  it("starts empty", async () => {
    await expect(context.repository.list()).resolves.toEqual([]);
  });

  describe("create", () => {
    it("applies the project defaults", async () => {
      const project = await context.repository.create(validInput);

      expect(project).toMatchObject({
        id: "id-1",
        name: "Travel Documentary",
        sourceLanguage: "en",
        targetLanguage: "pl",
        status: "draft",
        createdAt: "2026-08-25T10:00:00.000Z",
        updatedAt: "2026-08-25T10:00:00.000Z",
      });
    });

    it("persists under the versioned storage key", async () => {
      await context.repository.create(validInput);

      expect(context.storage.getItem("projects")).toBeNull();
      expect(context.stored()).toHaveLength(1);
    });

    it("gives each project a unique id", async () => {
      const first = await context.repository.create(validInput);
      const second = await context.repository.create(validInput);

      expect(first.id).not.toEqual(second.id);
    });

    it("trims the name", async () => {
      const project = await context.repository.create({
        ...validInput,
        name: "   Padded name   ",
      });

      expect(project.name).toBe("Padded name");
    });

    it.each([
      ["empty", ""],
      ["whitespace only", "   "],
      ["too long", "x".repeat(101)],
    ])("rejects a %s name", async (_label, name) => {
      await expect(
        context.repository.create({ ...validInput, name }),
      ).rejects.toBeInstanceOf(ProjectValidationError);
    });

    it("rejects identical source and target languages", async () => {
      await expect(
        context.repository.create({ ...validInput, targetLanguage: "en" }),
      ).rejects.toBeInstanceOf(ProjectValidationError);
    });

    it("rejects unknown language codes", async () => {
      await expect(
        context.repository.create({ ...validInput, sourceLanguage: "xx" }),
      ).rejects.toBeInstanceOf(ProjectValidationError);
    });
  });

  describe("update", () => {
    it("renames without changing the id or other metadata", async () => {
      const created = await context.repository.create(validInput);
      context.advance(60_000);

      const renamed = await context.repository.update(created.id, {
        name: "  Renamed project  ",
      });

      expect(renamed.id).toBe(created.id);
      expect(renamed.name).toBe("Renamed project");
      expect(renamed.createdAt).toBe(created.createdAt);
      expect(renamed.sourceLanguage).toBe(created.sourceLanguage);
      expect(renamed.targetLanguage).toBe(created.targetLanguage);
      expect(renamed.status).toBe(created.status);
    });

    it("refreshes updatedAt", async () => {
      const created = await context.repository.create(validInput);
      context.advance(90_000);

      const renamed = await context.repository.update(created.id, {
        name: "Renamed project",
      });

      expect(renamed.updatedAt).toBe("2026-08-25T10:01:30.000Z");
      expect(Date.parse(renamed.updatedAt)).toBeGreaterThan(
        Date.parse(created.updatedAt),
      );
    });

    it("persists the rename", async () => {
      const created = await context.repository.create(validInput);
      await context.repository.update(created.id, { name: "Renamed project" });

      await expect(context.repository.getById(created.id)).resolves.toMatchObject(
        { name: "Renamed project" },
      );
    });

    it("rejects an invalid name", async () => {
      const created = await context.repository.create(validInput);

      await expect(
        context.repository.update(created.id, { name: "  " }),
      ).rejects.toBeInstanceOf(ProjectValidationError);
    });

    it("rejects an unknown status", async () => {
      const created = await context.repository.create(validInput);

      await expect(
        context.repository.update(created.id, {
          status: "nonsense" as Project["status"],
        }),
      ).rejects.toBeInstanceOf(ProjectValidationError);
    });

    it("throws for a missing project", async () => {
      await expect(
        context.repository.update("does-not-exist", { name: "Nope" }),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });

  describe("delete", () => {
    it("removes only the requested project", async () => {
      const first = await context.repository.create(validInput);
      const second = await context.repository.create({
        ...validInput,
        name: "Second",
      });

      await context.repository.delete(first.id);

      await expect(context.repository.getById(first.id)).resolves.toBeNull();
      await expect(context.repository.list()).resolves.toEqual([second]);
    });

    it("throws for a missing project", async () => {
      await expect(
        context.repository.delete("does-not-exist"),
      ).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });

  describe("list", () => {
    it("sorts by updatedAt, most recent first", async () => {
      const first = await context.repository.create(validInput);
      context.advance(1_000);
      const second = await context.repository.create({
        ...validInput,
        name: "Second",
      });
      context.advance(1_000);
      const third = await context.repository.create({
        ...validInput,
        name: "Third",
      });

      await expect(context.repository.list()).resolves.toMatchObject([
        { id: third.id },
        { id: second.id },
        { id: first.id },
      ]);

      context.advance(1_000);
      await context.repository.update(first.id, { name: "Touched" });

      await expect(context.repository.list()).resolves.toMatchObject([
        { id: first.id },
        { id: third.id },
        { id: second.id },
      ]);
    });
  });

  describe("malformed stored data", () => {
    it("recovers from invalid JSON", async () => {
      context.storage.setItem(PROJECTS_STORAGE_KEY, "{not json");

      await expect(context.repository.list()).resolves.toEqual([]);
    });

    it("recovers when the stored value is not an array", async () => {
      context.storage.setItem(PROJECTS_STORAGE_KEY, '{"projects":[]}');

      await expect(context.repository.list()).resolves.toEqual([]);
    });

    it("drops structurally invalid records and keeps valid ones", async () => {
      const valid = {
        id: "kept",
        name: "Kept project",
        createdAt: "2026-08-25T10:00:00.000Z",
        updatedAt: "2026-08-25T10:00:00.000Z",
        sourceLanguage: "en",
        targetLanguage: "pl",
        status: "draft",
      };

      context.storage.setItem(
        PROJECTS_STORAGE_KEY,
        JSON.stringify([
          valid,
          null,
          "not an object",
          { ...valid, id: "" },
          { ...valid, id: "no-name", name: "   " },
          { ...valid, id: "bad-date", updatedAt: "yesterday" },
          { ...valid, id: "no-language", sourceLanguage: "" },
        ]),
      );

      await expect(context.repository.list()).resolves.toEqual([valid]);
    });

    it("falls back to draft for an unrecognised status", () => {
      const parsed = parseStoredProject({
        id: "id",
        name: "Name",
        createdAt: "2026-08-25T10:00:00.000Z",
        updatedAt: "2026-08-25T10:00:00.000Z",
        sourceLanguage: "en",
        targetLanguage: "pl",
        status: "exploded",
      });

      expect(parsed?.status).toBe("draft");
    });

    it("still allows creating a project after corrupt data", async () => {
      context.storage.setItem(PROJECTS_STORAGE_KEY, "garbage");

      const project = await context.repository.create(validInput);

      await expect(context.repository.list()).resolves.toEqual([project]);
    });
  });

  it("round-trips serialization through storage", async () => {
    const created = await context.repository.create(validInput);
    const rehydrated = new LocalProjectRepository({ storage: context.storage });

    await expect(rehydrated.getById(created.id)).resolves.toEqual(created);
  });
});

describe("sortProjectsByRecency", () => {
  const project = (id: string, updatedAt: string): Project => ({
    id,
    name: id,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt,
    sourceLanguage: "en",
    targetLanguage: "pl",
    status: "draft",
  });

  it("does not mutate the input", () => {
    const input = [
      project("a", "2026-08-25T10:00:00.000Z"),
      project("b", "2026-08-26T10:00:00.000Z"),
    ];

    const sorted = sortProjectsByRecency(input);

    expect(sorted.map((p) => p.id)).toEqual(["b", "a"]);
    expect(input.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
