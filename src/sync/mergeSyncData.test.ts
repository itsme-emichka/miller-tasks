import { describe, expect, it } from "vitest";

import { PluginData, TaskRecord } from "../domain/task";
import {
  getActiveSyncConflicts,
  isAttachmentPresent,
  isEntityPresent,
  mergePluginDataV3,
} from "./mergeSyncData";
import {
  clonePluginDataV3,
  MIGRATION_VERSION,
  migratePluginDataV2ToV3,
  PluginDataV3,
  serializePluginDataV3,
  VersionStamp,
} from "./syncData";

describe("schema-v3 state merge", () => {
  it("combines independent task creation and converges canonically", () => {
    const base = migratedData([]);
    const desktop = migratedData([task("desktop")]);
    const mobile = migratedData([task("mobile")]);

    const merged = mergePluginDataV3(desktop, mobile, base);
    const reversed = mergePluginDataV3(mobile, desktop, base);

    expect(merged.tasks.map((candidate) => candidate.id)).toEqual([
      "desktop",
      "mobile",
    ]);
    expect(serializePluginDataV3(reversed)).toBe(
      serializePluginDataV3(merged),
    );
    expect(
      serializePluginDataV3(mergePluginDataV3(merged, merged)),
    ).toBe(serializePluginDataV3(merged));
    expect(getActiveSyncConflicts(merged)).toEqual([]);
  });

  it("combines concurrent changes to different task fields", () => {
    const base = migratedData([task("shared")]);
    const desktop = clonePluginDataV3(base);
    const mobile = clonePluginDataV3(base);
    desktop.tasks[0]!.description = "Desktop description";
    desktop.tasks[0]!.fieldVersions.description = stamp(1, "desktop");
    desktop.tasks[0]!.updatedAt = 100;
    mobile.tasks[0]!.priority = "high";
    mobile.tasks[0]!.fieldVersions.priority = stamp(1, "mobile");
    mobile.tasks[0]!.updatedAt = 200;

    const merged = mergePluginDataV3(desktop, mobile, base);

    expect(merged.tasks[0]).toMatchObject({
      description: "Desktop description",
      priority: "high",
      updatedAt: 200,
    });
    expect(getActiveSyncConflicts(merged)).toEqual([]);
  });

  it("preserves a losing same-field value in one stable conflict", () => {
    const base = migratedData([task("shared")]);
    const desktop = clonePluginDataV3(base);
    const mobile = clonePluginDataV3(base);
    desktop.tasks[0]!.title = "Desktop title";
    desktop.tasks[0]!.fieldVersions.title = stamp(1, "desktop");
    mobile.tasks[0]!.title = "Mobile title";
    mobile.tasks[0]!.fieldVersions.title = stamp(1, "mobile");

    const merged = mergePluginDataV3(desktop, mobile, base);
    const reversed = mergePluginDataV3(mobile, desktop, base);
    const conflicts = getActiveSyncConflicts(merged);

    expect(merged.tasks[0]!.title).toBe("Mobile title");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      entityType: "task",
      entityId: "shared",
      fieldGroup: "title",
      leftValue: "Desktop title",
      rightValue: "Mobile title",
      winner: stamp(1, "mobile"),
    });
    expect(serializePluginDataV3(reversed)).toBe(
      serializePluginDataV3(merged),
    );
    expect(
      getActiveSyncConflicts(
        mergePluginDataV3(merged, reversed, base),
      ),
    ).toHaveLength(1);
  });

  it("does not report a causal edit as concurrent", () => {
    const base = migratedData([task("shared")]);
    const first = clonePluginDataV3(base);
    first.tasks[0]!.title = "First";
    first.tasks[0]!.fieldVersions.title = stamp(1, "desktop");
    const second = clonePluginDataV3(first);
    second.tasks[0]!.title = "Second";
    second.tasks[0]!.fieldVersions.title = stamp(2, "mobile");

    const merged = mergePluginDataV3(first, second, first);

    expect(merged.tasks[0]!.title).toBe("Second");
    expect(getActiveSyncConflicts(merged)).toEqual([]);
  });

  it("handles divergent migration baselines deterministically", () => {
    const desktop = migratedData([
      task("shared", { title: "Desktop legacy title" }),
    ]);
    const mobile = migratedData([
      task("shared", { title: "Mobile legacy title" }),
    ]);

    const merged = mergePluginDataV3(desktop, mobile);
    const reversed = mergePluginDataV3(mobile, desktop);

    expect(merged.tasks[0]!.title).toBe("Mobile legacy title");
    expect(getActiveSyncConflicts(merged)).toHaveLength(1);
    expect(serializePluginDataV3(reversed)).toBe(
      serializePluginDataV3(merged),
    );
  });

  it("keeps deletion effective until an intentional restore", () => {
    const source = migratedData([task("deleted")]);
    const deleted = clonePluginDataV3(source);
    deleted.entityTombstones.push({
      entityType: "task",
      id: "deleted",
      deleted: stamp(1, "desktop"),
      deletedAt: 100,
    });
    deleted.clock = 1;

    const merged = mergePluginDataV3(source, deleted, source);
    expect(isEntityPresent(merged, "task", "deleted")).toBe(false);

    const restored = clonePluginDataV3(merged);
    restored.tasks[0]!.existence = stamp(2, "desktop");
    restored.clock = 2;
    const restoredMerge = mergePluginDataV3(merged, restored, merged);

    expect(isEntityPresent(restoredMerge, "task", "deleted")).toBe(
      true,
    );
    expect(restoredMerge.entityTombstones).toHaveLength(1);
  });

  it("merges attachment adds and remove tombstones by ID", () => {
    const source = migratedData([
      task("image-task", {
        attachments: [
          {
            id: "image",
            path: "Miller Tasks/Attachments/image-task/image.png",
            name: "image.png",
            mimeType: "image/png",
            createdAt: 10,
          },
        ],
      }),
    ]);
    const removed = clonePluginDataV3(source);
    removed.attachmentTombstones.push({
      taskId: "image-task",
      attachmentId: "image",
      removed: stamp(1, "mobile"),
      removedAt: 50,
    });

    const merged = mergePluginDataV3(source, removed, source);

    expect(
      isAttachmentPresent(merged, "image-task", "image"),
    ).toBe(false);
    expect(merged.tasks[0]!.attachments).toHaveLength(1);

    merged.tasks[0]!.existence = MIGRATION_VERSION;
    merged.entityTombstones.push({
      entityType: "task",
      id: "image-task",
      deleted: stamp(2, "desktop"),
      deletedAt: 60,
    });
    expect(
      isAttachmentPresent(merged, "image-task", "image"),
    ).toBe(false);
  });

  it("dismisses a conflict with a versioned conflict tombstone", () => {
    const base = migratedData([task("shared")]);
    const desktop = clonePluginDataV3(base);
    const mobile = clonePluginDataV3(base);
    desktop.tasks[0]!.description = "Desktop";
    desktop.tasks[0]!.fieldVersions.description = stamp(3, "desktop");
    mobile.tasks[0]!.description = "Mobile";
    mobile.tasks[0]!.fieldVersions.description = stamp(3, "mobile");
    const merged = mergePluginDataV3(desktop, mobile, base);
    const conflict = getActiveSyncConflicts(merged)[0]!;
    const dismissed = clonePluginDataV3(merged);
    dismissed.conflictTombstones.push({
      id: conflict.id,
      dismissed: stamp(4, "mobile"),
      dismissedAt: 500,
    });

    const final = mergePluginDataV3(merged, dismissed, merged);

    expect(final.conflicts).toHaveLength(1);
    expect(getActiveSyncConflicts(final)).toEqual([]);
    expect(final.clock).toBe(4);
  });

  it("uses deterministic occurrence IDs to merge daily completion", () => {
    const source = migratedData([
      task("daily-instance", {
        title: "Review",
        today: true,
        todayAddedAt: 10,
        dailyTemplateId: "template",
        generatedForDate: "2026-07-29",
      }),
    ], [
      {
        id: "template",
        title: "Review",
        order: 0,
        createdAt: 10,
        updatedAt: 10,
      },
    ]);
    const completed = clonePluginDataV3(source);
    completed.dailyOccurrences[0]!.completed = true;
    completed.dailyOccurrences[0]!.completedAt = 100;
    completed.dailyOccurrences[0]!.fieldVersions.completion = stamp(
      1,
      "mobile",
    );

    const merged = mergePluginDataV3(source, completed, source);

    expect(merged.dailyOccurrences).toHaveLength(1);
    expect(merged.dailyOccurrences[0]).toMatchObject({
      id: "template:2026-07-29",
      completed: true,
      completedAt: 100,
      fieldVersions: {
        completion: stamp(1, "mobile"),
      },
    });
  });
});

function stamp(counter: number, actorId: string): VersionStamp {
  return { counter, actorId };
}

function migratedData(
  tasks: TaskRecord[],
  dailyTemplates: PluginData["dailyTemplates"] = [],
): PluginDataV3 {
  return migratePluginDataV2ToV3({
    schemaVersion: 2,
    showCompleted: false,
    tasks,
    dailyTemplates,
  });
}

function task(
  id: string,
  overrides: Partial<TaskRecord> = {},
): TaskRecord {
  return {
    id,
    parentId: null,
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
    order: 0,
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
