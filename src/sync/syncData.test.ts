import { describe, expect, it } from "vitest";

import {
  PluginData,
  TaskAttachment,
  TaskRecord,
} from "../domain/task";
import {
  canonicalizePluginDataV3,
  createDailyOccurrenceId,
  createMigrationPositionKey,
  MIGRATION_VERSION,
  migratePluginDataToV3,
  migratePluginDataV2ToV3,
  serializePluginDataV3,
} from "./syncData";

const IMAGE: TaskAttachment = {
  id: "image-1",
  path: "Miller Tasks/Attachments/root/image-1-photo.png",
  name: "photo.png",
  mimeType: "image/png",
  createdAt: 20,
};

describe("schema-v3 synchronization data", () => {
  it("migrates schema-v2 tasks without changing user values", () => {
    const source = data([
      task("root", null, 0, {
        title: "Project",
        description: "Keep this",
        tags: ["mobile", "sync"],
        dueDate: "2026-07-31",
        dueTime: "09:30",
        priority: "high",
        flagged: true,
        url: "https://example.com/",
        attachments: [IMAGE],
        today: true,
        todayAddedAt: 30,
      }),
      task("child", "root", 0, {
        completed: true,
        completedAt: 40,
      }),
    ]);

    const migrated = migratePluginDataV2ToV3(source);

    expect(migrated).toMatchObject({
      schemaVersion: 3,
      clock: 0,
      showCompleted: false,
      showCompletedVersion: MIGRATION_VERSION,
      entityTombstones: [],
      attachmentTombstones: [],
      conflicts: [],
      conflictTombstones: [],
    });
    expect(migrated.tasks).toHaveLength(2);
    expect(migrated.tasks[0]).toMatchObject({
      id: "child",
      parentId: "root",
      positionKey: createMigrationPositionKey(0),
      completed: true,
      completedAt: 40,
      existence: MIGRATION_VERSION,
    });
    expect(migrated.tasks[1]).toMatchObject({
      id: "root",
      parentId: null,
      title: "Project",
      description: "Keep this",
      tags: ["mobile", "sync"],
      dueDate: "2026-07-31",
      dueTime: "09:30",
      priority: "high",
      flagged: true,
      url: "https://example.com/",
      today: true,
      todayAddedAt: 30,
    });
    expect(migrated.tasks[1]?.attachments[0]).toEqual({
      ...IMAGE,
      added: MIGRATION_VERSION,
    });
    expect(
      Object.values(migrated.tasks[1]!.fieldVersions),
    ).toEqual(Array.from({ length: 10 }, () => MIGRATION_VERSION));
  });

  it("turns a daily instance into one deterministic occurrence", () => {
    const template = {
      id: "daily-template",
      title: "Review Today",
      order: 0,
      createdAt: 10,
      updatedAt: 20,
    };
    const occurrence = task("old-random-id", null, 0, {
      title: template.title,
      completed: true,
      completedAt: 50,
      today: true,
      todayAddedAt: 10,
      dailyTemplateId: template.id,
      generatedForDate: "2026-07-29",
    });
    const migrated = migratePluginDataV2ToV3({
      ...data([occurrence]),
      dailyTemplates: [template],
    });

    expect(migrated.tasks).toEqual([]);
    expect(migrated.dailyTemplates[0]).toMatchObject({
      id: template.id,
      title: template.title,
      positionKey: createMigrationPositionKey(0),
    });
    expect(migrated.dailyOccurrences).toEqual([
      {
        id: createDailyOccurrenceId(
          template.id,
          "2026-07-29",
        ),
        templateId: template.id,
        date: "2026-07-29",
        completed: true,
        description: "",
        tags: [],
        dueDate: null,
        dueTime: null,
        priority: "none",
        flagged: false,
        url: null,
        completedAt: 50,
        createdAt: 10,
        updatedAt: 10,
        todayAddedAt: 10,
        existence: MIGRATION_VERSION,
        fieldVersions: {
          description: MIGRATION_VERSION,
          tags: MIGRATION_VERSION,
          due: MIGRATION_VERSION,
          priority: MIGRATION_VERSION,
          flag: MIGRATION_VERSION,
          url: MIGRATION_VERSION,
          completion: MIGRATION_VERSION,
        },
      },
    ]);
  });

  it("migrates schema v1 through the validated schema-v2 path", () => {
    const legacy = task("legacy", null, 0);
    const {
      today: _today,
      todayAddedAt: _todayAddedAt,
      dailyTemplateId: _dailyTemplateId,
      generatedForDate: _generatedForDate,
      ...schemaOneTask
    } = legacy;

    const migrated = migratePluginDataToV3({
      schemaVersion: 1,
      showCompleted: true,
      tasks: [schemaOneTask],
    });

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.showCompleted).toBe(true);
    expect(migrated.tasks[0]).toMatchObject({
      id: "legacy",
      today: false,
      todayAddedAt: null,
    });
  });

  it("serializes canonically and returns defensive copies", () => {
    const source = migratePluginDataV2ToV3(
      data([
        task("z-last", null, 1),
        task("a-first", null, 0, {
          tags: ["one", "two"],
          attachments: [
            { ...IMAGE, id: "z-image" },
            { ...IMAGE, id: "a-image" },
          ],
        }),
      ]),
    );
    source.tasks.reverse();
    source.tasks
      .find((candidate) => candidate.id === "a-first")!
      .attachments.reverse();

    const canonical = canonicalizePluginDataV3(source);
    canonical.tasks[0]!.tags.push("outside");

    expect(
      source.tasks.find((candidate) => candidate.id === "a-first")
        ?.tags,
    ).toEqual(["one", "two"]);
    expect(canonical.tasks.map((candidate) => candidate.id)).toEqual([
      "a-first",
      "z-last",
    ]);
    expect(
      canonical.tasks[0]!.attachments.map(
        (attachment) => attachment.id,
      ),
    ).toEqual(["a-image", "z-image"]);
    expect(serializePluginDataV3(source)).toBe(
      serializePluginDataV3(canonicalizePluginDataV3(source)),
    );
    expect(serializePluginDataV3(source).endsWith("\n")).toBe(true);
  });
});

function task(
  id: string,
  parentId: string | null,
  order: number,
  overrides: Partial<TaskRecord> = {},
): TaskRecord {
  return {
    id,
    parentId,
    title: id,
    completed: false,
    description: "",
    tags: [],
    dueDate: null,
    dueTime: null,
    priority: "none",
    flagged: false,
    url: null,
    attachments: [],
    order,
    createdAt: 10,
    updatedAt: 10,
    completedAt: null,
    today: false,
    todayAddedAt: null,
    dailyTemplateId: null,
    generatedForDate: null,
    ...overrides,
  };
}

function data(tasks: TaskRecord[]): PluginData {
  return {
    schemaVersion: 2,
    showCompleted: false,
    tasks,
    dailyTemplates: [],
  };
}
