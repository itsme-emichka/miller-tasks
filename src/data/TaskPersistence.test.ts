import { describe, expect, it } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { PluginData } from "../domain/task";
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

    const first = createDefaultPluginData();
    first.tasks = [];
    const second = createDefaultPluginData();
    second.tasks = [];

    const firstSave = persistence.save(first);
    second.showCompleted = true;
    const secondSave = persistence.save(second);
    await Promise.all([firstSave, secondSave]);

    expect(maximumActiveWrites).toBe(1);
    expect(savedShowCompleted).toEqual([false, true]);
  });

  it("reloads the latest store state after queued saves", async () => {
    let persisted: PluginData | null = null;
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
  });
});
