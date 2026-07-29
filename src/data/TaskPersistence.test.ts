import { describe, expect, it } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import {
  createDefaultPluginDataV3,
  PluginDataV3,
} from "../sync/syncData";
import { TaskPersistence } from "./TaskPersistence";

describe("TaskPersistence", () => {
  it("serializes writes and preserves snapshot order", async () => {
    let activeWrites = 0;
    let maximumActiveWrites = 0;
    const savedShowCompleted: boolean[] = [];
    const persistence = new TaskPersistence(
      async () => null,
      async (data) => {
        activeWrites += 1;
        maximumActiveWrites = Math.max(
          maximumActiveWrites,
          activeWrites,
        );
        await new Promise((resolve) => window.setTimeout(resolve, 5));
        savedShowCompleted.push(data.showCompleted);
        activeWrites -= 1;
      },
    );

    const first = createDefaultPluginDataV3();
    const second = createDefaultPluginDataV3();

    const firstSave = persistence.save(first);
    second.showCompleted = true;
    const secondSave = persistence.save(second);
    await Promise.all([firstSave, secondSave]);

    expect(maximumActiveWrites).toBe(1);
    expect(savedShowCompleted).toEqual([false, true]);
  });

  it("reloads the latest store state after queued saves", async () => {
    let persisted: PluginDataV3 | null = null;
    const persistence = new TaskPersistence(
      async () => persisted,
      async (data) => {
        persisted = data;
      },
    );
    let id = 0;
    const store = new TaskStore(
      await persistence.load(),
      persistence,
      {
        idFactory: () => `task-${++id}`,
        now: () => 100,
      },
    );

    const created = store.createTask({ title: "Persisted" });
    store.updateTask(created.id, { description: "Saved in order" });
    await store.flush();

    const reloaded = new TaskStore(await persistence.load());
    expect(reloaded.getTask(created.id)).toMatchObject({
      title: "Persisted",
      description: "Saved in order",
    });

    store.undo();
    await store.flush();
    expect(
      new TaskStore(await persistence.load()).getTask(created.id)
        ?.description,
    ).toBe("");

    store.redo();
    await store.flush();
    expect(
      new TaskStore(await persistence.load()).getTask(created.id)
        ?.description,
    ).toBe("Saved in order");
  });

  it("migrates schema v2 before the first canonical schema-v3 save", async () => {
    const legacy = createDefaultPluginData();
    legacy.tasks.push({
      id: "legacy",
      parentId: null,
      title: "Preserved task",
      completed: false,
      description: "Legacy metadata",
      tags: ["migration"],
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
    });
    let persisted: unknown = legacy;
    const persistence = new TaskPersistence(
      async () => persisted,
      async (data) => {
        persisted = data;
      },
    );
    const loaded = await persistence.load();
    const store = new TaskStore(loaded, persistence, {
      actorId: "desktop",
      now: () => 20,
    });

    expect(loaded.schemaVersion).toBe(3);
    expect(store.getTask("legacy")).toMatchObject({
      title: "Preserved task",
      description: "Legacy metadata",
      tags: ["migration"],
    });

    store.updateTask("legacy", { flagged: true });
    await store.flush();

    expect(persisted).toMatchObject({
      schemaVersion: 3,
      clock: 1,
      tasks: [
        expect.objectContaining({
          id: "legacy",
          flagged: true,
        }),
      ],
    });
    expect(
      typeof (persisted as PluginDataV3).tasks[0]?.positionKey,
    ).toBe("string");
  });
});
