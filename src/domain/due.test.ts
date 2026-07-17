import { describe, expect, it } from "vitest";

import { TaskRecord } from "./task";
import { isTaskOverdue } from "./due";

const task: Pick<TaskRecord, "completed" | "dueDate" | "dueTime"> = {
  completed: false,
  dueDate: "2026-07-17",
  dueTime: null,
};

describe("isTaskOverdue", () => {
  it("handles past, future, and date-only today tasks", () => {
    const now = new Date(2026, 6, 17, 14, 30);

    expect(
      isTaskOverdue({ ...task, dueDate: "2026-07-16" }, now),
    ).toBe(true);
    expect(
      isTaskOverdue({ ...task, dueDate: "2026-07-18" }, now),
    ).toBe(false);
    expect(isTaskOverdue(task, now)).toBe(false);
  });

  it("uses local time for tasks due today", () => {
    const now = new Date(2026, 6, 17, 14, 30);

    expect(isTaskOverdue({ ...task, dueTime: "14:29" }, now)).toBe(
      true,
    );
    expect(isTaskOverdue({ ...task, dueTime: "14:30" }, now)).toBe(
      false,
    );
    expect(isTaskOverdue({ ...task, dueTime: "14:31" }, now)).toBe(
      false,
    );
  });

  it("never marks completed tasks overdue", () => {
    expect(
      isTaskOverdue(
        {
          completed: true,
          dueDate: "2026-07-16",
          dueTime: "00:00",
        },
        new Date(2026, 6, 17, 14, 30),
      ),
    ).toBe(false);
  });
});
