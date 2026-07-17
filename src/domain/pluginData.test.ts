import { describe, expect, it } from "vitest";

import {
  createDefaultPluginData,
  parsePluginData,
} from "./pluginData";
import { PluginData, TaskDomainError, TaskRecord } from "./task";

function task(
  id: string,
  parentId: string | null,
  order: number,
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
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
  };
}

function data(tasks: TaskRecord[]): PluginData {
  return {
    schemaVersion: 1,
    showCompleted: false,
    tasks,
  };
}

describe("parsePluginData", () => {
  it("creates defaults for a new vault and returns defensive copies", () => {
    expect(parsePluginData(null)).toEqual(createDefaultPluginData());

    const source = data([task("root", null, 0)]);
    const parsed = parsePluginData(source);
    source.tasks[0]!.title = "Changed outside";
    expect(parsed.tasks[0]?.title).toBe("root");
  });

  it("rejects missing parents, cycles, and broken sibling order", () => {
    expectTaskError(
      () => parsePluginData(data([task("child", "missing", 0)])),
      "parent-missing",
    );

    expectTaskError(
      () =>
        parsePluginData(
          data([
            task("first", "second", 0),
            task("second", "first", 0),
          ]),
        ),
      "cycle",
    );

    expectTaskError(
      () =>
        parsePluginData(
          data([
            task("first", null, 0),
            task("second", null, 2),
          ]),
        ),
      "data-invalid",
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
