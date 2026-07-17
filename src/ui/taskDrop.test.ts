import { describe, expect, it } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { TaskDomainError } from "../domain/task";
import { performTaskDrop, TaskDragData } from "./taskDrop";

describe("performTaskDrop", () => {
  it("reorders siblings and moves a task between rows", () => {
    const store = new TaskStore(createDefaultPluginData());
    const first = store.createTask({ title: "First" });
    const second = store.createTask({ title: "Second" });
    const child = store.createTask({
      parentId: first.id,
      title: "Child",
    });
    const active: TaskDragData = {
      type: "task",
      taskId: second.id,
      parentId: null,
      index: 1,
    };

    performTaskDrop(store, active, {
      type: "task",
      taskId: first.id,
      parentId: null,
      index: 0,
    });
    expect(store.getChildren(null).map((task) => task.id)).toEqual([
      second.id,
      first.id,
    ]);

    performTaskDrop(
      store,
      { ...active, index: 0 },
      {
        type: "task",
        taskId: child.id,
        parentId: first.id,
        index: 0,
      },
      "after",
    );
    expect(store.getChildren(first.id).map((task) => task.id)).toEqual(
      [child.id, second.id],
    );
  });

  it("drops on a row as a child and keeps cycle protection", () => {
    const store = new TaskStore(createDefaultPluginData());
    const parent = store.createTask({ title: "Parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Child",
    });

    expect(() =>
      performTaskDrop(
        store,
        {
          type: "task",
          taskId: parent.id,
          parentId: null,
          index: 0,
        },
        {
          type: "task",
          taskId: child.id,
          parentId: parent.id,
          index: 0,
        },
      ),
    ).toThrowError(TaskDomainError);
  });
});
