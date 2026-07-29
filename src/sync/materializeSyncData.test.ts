import { describe, expect, it } from "vitest";

import { PluginData, TaskRecord } from "../domain/task";
import { materializePluginDataV3 } from "./materializeSyncData";
import { migratePluginDataV2ToV3 } from "./syncData";

describe("schema-v3 task view materialization", () => {
  it("restores the schema-v2 view without changing user tasks", () => {
    const source = data([
      task("root", null, 0, {
        title: "Root",
        today: true,
        todayAddedAt: 20,
      }),
      task("child", "root", 0, {
        title: "Child",
      }),
    ]);
    const materialized = materializePluginDataV3(
      migratePluginDataV2ToV3(source),
    );

    expect(materialized).toMatchObject({
      schemaVersion: 2,
      showCompleted: source.showCompleted,
      dailyTemplates: source.dailyTemplates,
    });
    expect(
      [...materialized.tasks].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    ).toEqual(
      [...source.tasks].sort((left, right) =>
        left.id.localeCompare(right.id),
      ),
    );
  });

  it("derives contiguous view order from stable positions", () => {
    const synced = migratePluginDataV2ToV3(
      data([
        task("first", null, 0),
        task("second", null, 1),
        task("third", null, 2),
      ]),
    );
    synced.tasks.find((task) => task.id === "third")!.positionKey =
      "F";

    const materialized = materializePluginDataV3(synced);
    const ordered = [...materialized.tasks].sort(
      (left, right) => left.order - right.order,
    );

    expect(ordered.map((task) => task.id)).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect(ordered.map((task) => task.order)).toEqual([0, 1, 2]);
  });

  it("hides tombstoned records and attachments", () => {
    const synced = migratePluginDataV2ToV3(
      data([
        task("keep", null, 0, {
          attachments: [
            {
              id: "image",
              path: "Miller Tasks/Attachments/keep/image.png",
              name: "image.png",
              mimeType: "image/png",
              createdAt: 1,
            },
          ],
        }),
        task("delete", null, 1),
      ]),
    );
    synced.clock = 1;
    synced.entityTombstones.push({
      entityType: "task",
      id: "delete",
      deleted: { counter: 1, actorId: "device" },
      deletedAt: 2,
    });
    synced.attachmentTombstones.push({
      taskId: "keep",
      attachmentId: "image",
      removed: { counter: 1, actorId: "device" },
      removedAt: 2,
    });

    const materialized = materializePluginDataV3(synced);

    expect(materialized.tasks.map((task) => task.id)).toEqual(["keep"]);
    expect(materialized.tasks[0]!.attachments).toEqual([]);
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
