import { describe, expect, it, vi } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { TaskDraftBuffer } from "./TaskDraftBuffer";

describe("TaskDraftBuffer", () => {
  it("flushes pending text before a task switch or plugin unload", () => {
    vi.useFakeTimers();
    const store = new TaskStore(createDefaultPluginData());
    const task = store.createTask({ title: "Draft" });
    const drafts = new TaskDraftBuffer(store);

    drafts.queue(task.id, { description: "Pending work" });
    drafts.flushAll();

    expect(store.getTask(task.id)?.description).toBe("Pending work");
    vi.useRealTimers();
  });
});
