import { describe, expect, it } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { TaskSelection } from "./TaskSelection";
import { runTaskRollover } from "./runTaskRollover";

describe("runTaskRollover", () => {
  it("replaces a selected daily instance and clears stale selection", () => {
    let id = 0;
    const dayOne = new Date(2026, 6, 17, 23, 59).getTime();
    const dayTwo = new Date(2026, 6, 18, 0, 1).getTime();
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `daily-${++id}`,
        now: () => dayOne,
      },
    );
    const selection = new TaskSelection();
    const template = store.createDailyTemplate("Plan tomorrow");
    const oldInstance = store.getTasksForDailyTemplate(template.id)[0]!;
    selection.setSelectedTaskId(oldInstance.id);

    const result = runTaskRollover(store, selection, dayTwo);

    expect(result.removed.map((task) => task.id)).toEqual([
      oldInstance.id,
    ]);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.completed).toBe(false);
    expect(result.created[0]?.id).not.toBe(oldInstance.id);
    expect(selection.getSelectedTaskId()).toBeNull();
  });
});
