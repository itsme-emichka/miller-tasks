import { describe, expect, it } from "vitest";

import { createDefaultPluginData } from "./pluginData";
import { TaskStore } from "./TaskStore";
import { MAX_TASK_DEPTH, TaskDomainError } from "./task";

function createStore(): TaskStore {
  let id = 0;
  let now = 1_000;
  return new TaskStore(createDefaultPluginData(), undefined, {
    idFactory: () => `task-${++id}`,
    now: () => ++now,
  });
}

describe("TaskStore", () => {
  it("allows ten levels and rejects level eleven", () => {
    const store = createStore();
    let parentId: string | null = null;

    for (let depth = 1; depth <= MAX_TASK_DEPTH; depth += 1) {
      parentId = store.createTask({ parentId }).id;
      expect(store.getDepth(parentId)).toBe(depth);
    }

    expectTaskError(
      () => store.createTask({ parentId }),
      "depth-exceeded",
    );
  });

  it("rejects cycles and moves that make a subtree too deep", () => {
    const store = createStore();
    const root = store.createTask({ title: "Root" });
    const child = store.createTask({
      parentId: root.id,
      title: "Child",
    });

    expectTaskError(() => store.moveTask(root.id, child.id), "cycle");

    let deepParent = store.createTask({ title: "Deep root" }).id;
    for (let depth = 2; depth <= MAX_TASK_DEPTH; depth += 1) {
      deepParent = store.createTask({ parentId: deepParent }).id;
    }

    expectTaskError(
      () => store.moveTask(root.id, deepParent),
      "depth-exceeded",
    );
  });

  it("preserves normalized sibling order across reorder and move", () => {
    const store = createStore();
    const first = store.createTask({ title: "First" });
    const second = store.createTask({ title: "Second" });
    const third = store.createTask({ title: "Third" });

    store.reorderTask(third.id, 0);
    expect(store.getChildren(null).map((task) => task.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
    expect(store.getChildren(null).map((task) => task.order)).toEqual([
      0, 1, 2,
    ]);

    store.moveTask(second.id, first.id, 0);
    expect(store.getChildren(null).map((task) => task.id)).toEqual([
      third.id,
      first.id,
    ]);
    expect(store.getChildren(first.id).map((task) => task.id)).toEqual([
      second.id,
    ]);
  });

  it("completes descendants but reopens only the selected task", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Child",
    });
    const grandchild = store.createTask({
      parentId: child.id,
      title: "Grandchild",
    });

    expect(store.completeSubtree(parent.id, true)).toEqual([
      parent.id,
      child.id,
      grandchild.id,
    ]);
    expect(
      [parent.id, child.id, grandchild.id].map(
        (id) => store.getTask(id)?.completed,
      ),
    ).toEqual([true, true, true]);

    expect(store.completeSubtree(parent.id, false)).toEqual([parent.id]);
    expect(store.getTask(parent.id)?.completed).toBe(false);
    expect(store.getTask(child.id)?.completed).toBe(true);
    expect(store.getTask(grandchild.id)?.completed).toBe(true);
  });

  it("deletes a subtree and closes the sibling-order gap", () => {
    const store = createStore();
    const first = store.createTask({ title: "First" });
    const second = store.createTask({ title: "Second" });
    const child = store.createTask({
      parentId: second.id,
      title: "Child",
    });
    const third = store.createTask({ title: "Third" });

    expect(
      store.deleteSubtree(second.id).map((task) => task.id),
    ).toEqual([second.id, child.id]);
    expect(store.getChildren(null).map((task) => task.id)).toEqual([
      first.id,
      third.id,
    ]);
    expect(store.getChildren(null).map((task) => task.order)).toEqual([
      0, 1,
    ]);
  });

  it("normalizes editable metadata and rejects invalid values", () => {
    const store = createStore();
    const task = store.createTask({ title: "  Task  " });

    const updated = store.updateTask(task.id, {
      tags: [" #Work ", "work", "two words"],
      dueDate: "2026-07-17",
      dueTime: "09:30",
      url: "https://example.com/task",
    });

    expect(updated.title).toBe("Task");
    expect(updated.tags).toEqual(["Work", "two-words"]);
    expect(updated.url).toBe("https://example.com/task");

    expect(() =>
      store.updateTask(task.id, { title: "   " }),
    ).toThrowError(TaskDomainError);
    expectTaskError(
      () =>
        store.updateTask(task.id, { dueDate: "2026-02-30" }),
      "date-invalid",
    );
    expectTaskError(
      () =>
        store.updateTask(task.id, { url: "obsidian://task" }),
      "url-invalid",
    );
  });
});

function expectTaskError(
  action: () => unknown,
  code: TaskDomainError["code"],
): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskDomainError);
    expect((error as TaskDomainError).code).toBe(code);
    return;
  }
  throw new Error(`Expected TaskDomainError with code ${code}.`);
}
