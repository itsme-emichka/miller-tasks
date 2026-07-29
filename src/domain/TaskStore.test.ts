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

  it("keeps unfinished Today tasks and clears completed ones after 24 hours", () => {
    let now = new Date(2026, 6, 18, 10, 0).getTime();
    let id = 0;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `today-${++id}`,
        now: () => now,
      },
    );
    const unfinished = store.createTask({ title: "Carry forward" });
    const completed = store.createTask({ title: "Finish once" });
    store.setTaskToday(unfinished.id, true);
    store.setTaskToday(completed.id, true);
    store.completeSubtree(completed.id, true);

    now += 24 * 60 * 60 * 1_000 - 1;
    expect(store.getTodayTasks(now).map((task) => task.id)).toEqual([
      unfinished.id,
      completed.id,
    ]);

    now += 1;
    const result = store.rollover(now);
    expect(result.clearedToday).toEqual([completed.id]);
    expect(store.getTodayTasks(now).map((task) => task.id)).toEqual([
      unfinished.id,
    ]);
    expect(store.getTask(completed.id)?.today).toBe(false);
  });

  it("replaces daily task instances at local midnight", () => {
    let now = new Date(2026, 6, 18, 10, 0).getTime();
    let id = 0;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `daily-${++id}`,
        now: () => now,
      },
    );
    const template = store.createDailyTemplate("Drink water");
    const first = store.getTodayTasks(now)[0]!;
    expect(first).toMatchObject({
      title: "Drink water",
      dailyTemplateId: template.id,
      generatedForDate: "2026-07-18",
    });
    store.completeSubtree(first.id, true);

    now = new Date(2026, 6, 19, 0, 1).getTime();
    const result = store.rollover(now);
    const second = store.getTodayTasks(now)[0]!;
    expect(result.removed.map((task) => task.id)).toEqual([first.id]);
    expect(second).toMatchObject({
      title: "Drink water",
      completed: false,
      dailyTemplateId: template.id,
      generatedForDate: "2026-07-19",
    });
    expect(second.id).not.toBe(first.id);
    expect(store.getTask(first.id)).toBeUndefined();

    store.updateDailyTemplate(template.id, "Hydrate");
    expect(store.getTask(second.id)?.title).toBe("Hydrate");
    expect(store.deleteDailyTemplate(template.id)).toHaveLength(1);
    expect(store.getDailyTemplates()).toHaveLength(0);
    expect(store.getTodayTasks(now)).toHaveLength(0);
  });

  it("places daily instances after ordinary Today tasks", () => {
    const store = createStore();
    const template = store.createDailyTemplate("Daily routine");
    const daily = store.getTasksForDailyTemplate(template.id)[0]!;
    const ordinary = store.createTask({ title: "Specific task" });
    store.setTaskToday(ordinary.id, true);

    expect(store.getTodayTasks().map((task) => task.id)).toEqual([
      ordinary.id,
      daily.id,
    ]);
  });

  it("places completed tasks last inside each Today group", () => {
    const store = createStore();
    const completedOrdinary = store.createTask({
      title: "Completed ordinary",
    });
    store.setTaskToday(completedOrdinary.id, true);
    store.completeSubtree(completedOrdinary.id, true);
    const openOrdinary = store.createTask({ title: "Open ordinary" });
    store.setTaskToday(openOrdinary.id, true);
    const completedTemplate = store.createDailyTemplate(
      "Completed daily",
    );
    const completedDaily = store.getTasksForDailyTemplate(
      completedTemplate.id,
    )[0]!;
    store.completeSubtree(completedDaily.id, true);
    const openTemplate = store.createDailyTemplate("Open daily");
    const openDaily = store.getTasksForDailyTemplate(openTemplate.id)[0]!;

    expect(store.getTodayTasks().map((task) => task.id)).toEqual([
      openOrdinary.id,
      completedOrdinary.id,
      openDaily.id,
      completedDaily.id,
    ]);
  });

  it("projects only recursive leaf descendants into Today", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    const directLeaf = store.createTask({
      parentId: parent.id,
      title: "Direct leaf",
    });
    const branch = store.createTask({
      parentId: parent.id,
      title: "Nested branch",
    });
    const nestedLeaf = store.createTask({
      parentId: branch.id,
      title: "Nested leaf",
    });

    store.setTaskToday(parent.id, true);

    expect(store.getTodayTasks().map((task) => task.id)).toEqual([
      directLeaf.id,
      nestedLeaf.id,
    ]);
    expect(store.getTask(parent.id)?.today).toBe(false);
    expect(store.getTask(branch.id)?.today).toBe(false);
    expect(store.isTaskScheduledForToday(parent.id)).toBe(true);

    store.setTaskToday(parent.id, false);
    expect(store.getTodayTasks()).toHaveLength(0);
    expect(store.isTaskScheduledForToday(parent.id)).toBe(false);
  });

  it("completes and reopens ancestors from child completion", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    const first = store.createTask({
      parentId: parent.id,
      title: "First",
    });
    const branch = store.createTask({
      parentId: parent.id,
      title: "Branch",
    });
    const nested = store.createTask({
      parentId: branch.id,
      title: "Nested",
    });

    store.completeSubtree(first.id, true);
    expect(store.getTask(parent.id)?.completed).toBe(false);
    store.completeSubtree(nested.id, true);

    expect(store.getTask(branch.id)?.completed).toBe(true);
    expect(store.getTask(parent.id)?.completed).toBe(true);

    store.completeSubtree(nested.id, false);
    expect(store.getTask(branch.id)?.completed).toBe(false);
    expect(store.getTask(parent.id)?.completed).toBe(false);
    expect(store.getTask(first.id)?.completed).toBe(true);
  });

  it("undoes and redoes complete tree mutations in order", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Child",
    });
    store.completeSubtree(child.id, true);
    store.moveTask(child.id, null);
    store.deleteSubtree(parent.id);

    expect(store.getTask(parent.id)).toBeUndefined();
    expect(store.undo()).toMatchObject({
      label: "Delete “Parent”",
      taskId: parent.id,
    });
    expect(store.getTask(parent.id)?.title).toBe("Parent");

    expect(store.undo()?.label).toBe("Move “Child”");
    expect(store.getTask(child.id)?.parentId).toBe(parent.id);

    expect(store.undo()?.label).toBe("Complete “Child”");
    expect(store.getTask(child.id)?.completed).toBe(false);
    expect(store.getTask(parent.id)?.completed).toBe(false);

    expect(store.redo()?.label).toBe("Complete “Child”");
    expect(store.getTask(child.id)?.completed).toBe(true);
    expect(store.getTask(parent.id)?.completed).toBe(true);
    expect(store.redo()?.label).toBe("Move “Child”");
    expect(store.getTask(child.id)?.parentId).toBeNull();
  });

  it("invalidates redo after a new edit", () => {
    const store = createStore();
    const task = store.createTask({ title: "First title" });
    store.updateTask(task.id, { title: "Second title" });

    store.undo();
    expect(store.getTask(task.id)?.title).toBe("First title");
    expect(store.canRedo()).toBe(true);

    store.updateTask(task.id, { title: "Different title" });
    expect(store.canRedo()).toBe(false);
    expect(store.redo()).toBeNull();
  });

  it("keeps only the configured number of history entries", () => {
    let id = 0;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `bounded-${++id}`,
        now: () => id,
        historyLimit: 2,
      },
    );
    const first = store.createTask({ title: "First" });
    const second = store.createTask({ title: "Second" });
    const third = store.createTask({ title: "Third" });

    expect(store.undo()?.taskId).toBe(third.id);
    expect(store.undo()?.taskId).toBe(second.id);
    expect(store.undo()).toBeNull();
    expect(store.getTask(first.id)).toBeDefined();
  });

  it("preserves completed visibility across task undo", () => {
    const store = createStore();
    const task = store.createTask({ title: "Temporary" });
    store.setShowCompleted(true);

    expect(store.undo()?.taskId).toBe(task.id);
    expect(store.getTask(task.id)).toBeUndefined();
    expect(store.getSnapshot().showCompleted).toBe(true);
  });

  it("versions undo and redo as new atomic field changes", () => {
    let now = 1_000;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => "history-task",
        now: () => ++now,
        actorId: "desktop",
      },
    );
    const task = store.createTask({ title: "Original" });
    store.updateTask(task.id, { description: "Edited" });

    expect(store.undo()?.taskId).toBe(task.id);
    const undone = store.getSyncSnapshot();
    expect(undone.clock).toBe(3);
    expect(undone.tasks[0]?.description).toBe("");
    expect(undone.tasks[0]?.fieldVersions.description).toEqual({
      counter: 3,
      actorId: "desktop",
    });
    expect(undone.tasks[0]?.fieldVersions.title).toEqual({
      counter: 1,
      actorId: "desktop",
    });

    expect(store.redo()?.taskId).toBe(task.id);
    const redone = store.getSyncSnapshot();
    expect(redone.clock).toBe(4);
    expect(redone.tasks[0]?.description).toBe("Edited");
    expect(redone.tasks[0]?.fieldVersions.description).toEqual({
      counter: 4,
      actorId: "desktop",
    });
    expect(redone.tasks[0]?.fieldVersions.title).toEqual({
      counter: 1,
      actorId: "desktop",
    });
  });

  it("uses fresh tombstones and existence versions for history", () => {
    let now = 1_000;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => "created-task",
        now: () => ++now,
        actorId: "mobile",
      },
    );
    const task = store.createTask({ title: "Temporary" });

    store.undo();
    const undone = store.getSyncSnapshot();
    expect(store.getTask(task.id)).toBeUndefined();
    expect(undone.clock).toBe(2);
    expect(undone.entityTombstones[0]?.deleted).toEqual({
      counter: 2,
      actorId: "mobile",
    });

    store.redo();
    const redone = store.getSyncSnapshot();
    const resurrected = redone.tasks[0]!;
    expect(store.getTask(task.id)?.title).toBe("Temporary");
    expect(redone.clock).toBe(3);
    expect(resurrected.existence).toEqual({
      counter: 3,
      actorId: "mobile",
    });
    expect(
      new Set(
        Object.values(resurrected.fieldVersions).map(
          (version) => `${version.counter}:${version.actorId}`,
        ),
      ),
    ).toEqual(new Set(["3:mobile"]));
  });

  it("reverses subtree deletion with fresh shared versions", () => {
    let id = 0;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `history-delete-${++id}`,
        now: () => id,
        actorId: "desktop",
      },
    );
    const parent = store.createTask({ title: "Parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Child",
    });
    store.deleteSubtree(parent.id);

    store.undo();
    const restored = store.getSyncSnapshot();
    expect(store.getTask(parent.id)).toBeDefined();
    expect(store.getTask(child.id)).toBeDefined();
    expect(
      restored.tasks.map((task) => task.existence),
    ).toEqual([
      { counter: 4, actorId: "desktop" },
      { counter: 4, actorId: "desktop" },
    ]);

    store.redo();
    const deletedAgain = store.getSyncSnapshot();
    expect(store.getTask(parent.id)).toBeUndefined();
    expect(store.getTask(child.id)).toBeUndefined();
    expect(
      deletedAgain.entityTombstones.map(
        (tombstone) => tombstone.deleted,
      ),
    ).toEqual([
      { counter: 5, actorId: "desktop" },
      { counter: 5, actorId: "desktop" },
    ]);
  });

  it("clears history only for a material incoming sync state", () => {
    const store = createStore();
    store.createTask({ title: "Local" });
    const unchanged = store.getSyncSnapshot();

    expect(store.replaceFromSync(unchanged)).toBe(false);
    expect(store.canUndo()).toBe(true);

    const remote = new TaskStore(unchanged, undefined, {
      actorId: "remote",
      idFactory: () => "remote-task",
      now: () => 2_000,
    });
    remote.createTask({ title: "Remote" });

    expect(store.replaceFromSync(remote.getSyncSnapshot())).toBe(true);
    expect(store.canUndo()).toBe(false);
    expect(store.getTask("remote-task")?.title).toBe("Remote");
  });

  it("clears unsafe history when image files or rollover change", () => {
    const store = createStore();
    const task = store.createTask({ title: "With image" });
    store.addAttachment(task.id, {
      id: "attachment-1",
      path: "Miller Tasks/Attachments/task-1/image.png",
      name: "image.png",
      mimeType: "image/png",
      createdAt: 1_000,
    });

    expect(store.canUndo()).toBe(false);
    store.updateTask(task.id, { description: "New history" });
    expect(store.canUndo()).toBe(true);
    store.deleteSubtree(task.id);
    expect(store.canUndo()).toBe(false);

    const template = store.createDailyTemplate("Daily");
    expect(store.canUndo()).toBe(true);
    const instance = store.getTasksForDailyTemplate(template.id)[0]!;
    store.rollover(
      new Date(
        `${instance.generatedForDate}T00:00:00`,
      ).getTime() +
        24 * 60 * 60 * 1_000,
    );
    expect(store.canUndo()).toBe(false);
  });

  it("versions only the atomic field groups changed by an edit", () => {
    let now = 1_000;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => "versioned-task",
        now: () => ++now,
        actorId: "desktop",
      },
    );
    const created = store.createTask({ title: "Original" });
    const afterCreate = store.getSyncSnapshot();
    const createdRecord = afterCreate.tasks[0]!;

    expect(afterCreate.clock).toBe(1);
    expect(createdRecord.existence).toEqual({
      counter: 1,
      actorId: "desktop",
    });
    expect(
      new Set(
        Object.values(createdRecord.fieldVersions).map(
          (version) => `${version.counter}:${version.actorId}`,
        ),
      ),
    ).toEqual(new Set(["1:desktop"]));

    store.updateTask(created.id, {
      description: "Edited",
      priority: "high",
    });
    const afterEdit = store.getSyncSnapshot();
    const edited = afterEdit.tasks[0]!;

    expect(afterEdit.clock).toBe(2);
    expect(edited.fieldVersions.description.counter).toBe(2);
    expect(edited.fieldVersions.priority.counter).toBe(2);
    expect(edited.fieldVersions.title.counter).toBe(1);
    expect(edited.fieldVersions.due.counter).toBe(1);

    store.updateTask(created.id, {
      description: "Edited",
      priority: "high",
    });
    expect(store.getSyncSnapshot().clock).toBe(2);
  });

  it("reorders by changing only the moved task position", () => {
    let id = 0;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `position-${++id}`,
        now: () => id,
        actorId: "desktop",
      },
    );
    const first = store.createTask({ title: "First" });
    const second = store.createTask({ title: "Second" });
    const third = store.createTask({ title: "Third" });
    const before = store.getSyncSnapshot();
    const firstBefore = before.tasks.find(
      (task) => task.id === first.id,
    )!;
    const secondBefore = before.tasks.find(
      (task) => task.id === second.id,
    )!;

    store.reorderTask(third.id, 0);
    const after = store.getSyncSnapshot();
    const firstAfter = after.tasks.find(
      (task) => task.id === first.id,
    )!;
    const secondAfter = after.tasks.find(
      (task) => task.id === second.id,
    )!;
    const thirdAfter = after.tasks.find(
      (task) => task.id === third.id,
    )!;

    expect(firstAfter.positionKey).toBe(firstBefore.positionKey);
    expect(secondAfter.positionKey).toBe(secondBefore.positionKey);
    expect(firstAfter.fieldVersions.structure).toEqual(
      firstBefore.fieldVersions.structure,
    );
    expect(secondAfter.fieldVersions.structure).toEqual(
      secondBefore.fieldVersions.structure,
    );
    expect(thirdAfter.fieldVersions.structure).toEqual({
      counter: 4,
      actorId: "desktop",
    });
    expect(store.getChildren(null).map((task) => task.id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);
  });

  it("persists subtree deletion as shared-version tombstones", () => {
    let id = 0;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `delete-${++id}`,
        now: () => id,
        actorId: "mobile",
      },
    );
    const parent = store.createTask({ title: "Parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Child",
    });

    store.deleteSubtree(parent.id);
    const deleted = store.getSyncSnapshot();

    expect(store.getTask(parent.id)).toBeUndefined();
    expect(store.getTask(child.id)).toBeUndefined();
    expect(deleted.tasks).toHaveLength(2);
    expect(deleted.entityTombstones).toEqual([
      {
        entityType: "task",
        id: parent.id,
        deleted: { counter: 3, actorId: "mobile" },
        deletedAt: 2,
      },
      {
        entityType: "task",
        id: child.id,
        deleted: { counter: 3, actorId: "mobile" },
        deletedAt: 2,
      },
    ]);
  });

  it("versions attachments, preferences, templates, and occurrences", () => {
    let id = 0;
    let now = new Date("2026-07-29T10:00:00").getTime();
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `metadata-${++id}`,
        now: () => ++now,
        actorId: "desktop",
      },
    );
    const task = store.createTask({ title: "Task" });
    store.addAttachment(task.id, {
      id: "image",
      path: "Miller Tasks/Attachments/metadata-1/image.png",
      name: "image.png",
      mimeType: "image/png",
      createdAt: now,
    });
    store.removeAttachment(task.id, "image");
    store.setShowCompleted(true);
    const template = store.createDailyTemplate("Daily");
    const occurrence = store.getTasksForDailyTemplate(template.id)[0]!;
    store.updateTask(occurrence.id, {
      description: "On this date",
    });
    store.completeSubtree(occurrence.id, true);

    const synced = store.getSyncSnapshot();
    const syncedTask = synced.tasks.find(
      (candidate) => candidate.id === task.id,
    )!;
    const syncedOccurrence = synced.dailyOccurrences[0]!;

    expect(syncedTask.attachments[0]!.added.counter).toBe(2);
    expect(synced.attachmentTombstones[0]!.removed.counter).toBe(3);
    expect(synced.showCompletedVersion.counter).toBe(4);
    expect(synced.dailyTemplates[0]!.existence.counter).toBe(5);
    expect(syncedOccurrence.fieldVersions.description.counter).toBe(6);
    expect(syncedOccurrence.fieldVersions.completion.counter).toBe(7);
    expect(syncedOccurrence.id).toBe(
      `${template.id}:${occurrence.generatedForDate}`,
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
