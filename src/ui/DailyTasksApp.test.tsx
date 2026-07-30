import {
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { DailyTasksApp } from "./DailyTasksApp";

function createStore(): TaskStore {
  let id = 0;
  return new TaskStore(createDefaultPluginData(), undefined, {
    idFactory: () => `task-${++id}`,
    now: () => Date.now(),
  });
}

describe("DailyTasksApp", () => {
  it("keeps the dedicated editor synchronized with template changes", () => {
    const store = createStore();
    const template = store.createDailyTemplate("Morning review");
    const deleteTemplate = vi.fn(async (templateId: string) => {
      store.deleteDailyTemplate(templateId);
    });
    render(
      <DailyTasksApp
        store={store}
        actions={{ deleteTemplate }}
      />,
    );
    const templateTitle = screen.getByRole("textbox", {
      name: "Daily task Morning review",
    });

    fireEvent.change(templateTitle, {
      target: { value: "Morning plan" },
    });
    fireEvent.blur(templateTitle);
    expect(store.getDailyTemplates()[0]?.title).toBe("Morning plan");

    const newDailyTask = screen.getByRole("textbox", {
      name: "New daily task",
    });
    fireEvent.change(newDailyTask, {
      target: { value: "Evening review" },
    });
    fireEvent.submit(newDailyTask.closest("form")!);
    expect(store.getDailyTemplates()).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete daily task Morning plan",
      }),
    );
    expect(deleteTemplate).toHaveBeenCalledWith(
      template.id,
      "Morning plan",
    );
    expect(store.getDailyTemplates()).toHaveLength(1);
  });
});
