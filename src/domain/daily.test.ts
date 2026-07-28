import { describe, expect, it } from "vitest";

import { isTreeTaskVisible } from "./daily";

describe("isTreeTaskVisible", () => {
  const task = {
    completed: true,
    completedAt: new Date(2026, 6, 18, 23, 59).getTime(),
    dailyTemplateId: null,
  };

  it("keeps a completed tree task through its local completion day", () => {
    expect(
      isTreeTaskVisible(
        task,
        false,
        new Date(2026, 6, 18, 23, 59, 59).getTime(),
      ),
    ).toBe(true);
  });

  it("hides it on the next local day unless completed tasks are shown", () => {
    const nextDay = new Date(2026, 6, 19, 0, 0).getTime();
    expect(isTreeTaskVisible(task, false, nextDay)).toBe(false);
    expect(isTreeTaskVisible(task, true, nextDay)).toBe(true);
  });
});
