import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { TaskSelection } from "../state/TaskSelection";
import { TaskTreeApp } from "./TaskTreeApp";

function createStore(): TaskStore {
  let id = 0;
  return new TaskStore(createDefaultPluginData(), undefined, {
    idFactory: () => `task-${++id}`,
    now: () => Date.now(),
  });
}

describe("TaskTreeApp", () => {
  it("renders the full hierarchy with parents above children", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Child",
    });
    store.completeSubtree(child.id, true);
    const { container } = render(
      <TaskTreeApp
        store={store}
        selection={new TaskSelection()}
      />,
    );
    const parentNode = container.querySelector<HTMLElement>(
      `[data-task-id="${parent.id}"]`,
    )!;
    const childNode = container.querySelector<HTMLElement>(
      `[data-task-id="${child.id}"]`,
    )!;

    expect(Number.parseFloat(parentNode.style.top)).toBeLessThan(
      Number.parseFloat(childNode.style.top),
    );
    expect(childNode).toHaveAttribute("data-completed", "true");
    expect(container.querySelectorAll(".miller-task-tree-edges path"))
      .toHaveLength(1);
  });

  it("selects, completes, and deletes nodes through shared actions", () => {
    const store = createStore();
    const task = store.createTask({ title: "Interactive" });
    const selection = new TaskSelection();
    const selected = vi.fn();
    const completed = vi.fn();
    const deleted = vi.fn();
    const { container } = render(
      <TaskTreeApp
        store={store}
        selection={selection}
        onTaskSelected={selected}
        onTaskCompletion={completed}
        onTaskDelete={deleted}
      />,
    );
    const title = screen.getByRole("button", {
      name: "Interactive",
    });

    fireEvent.click(title);
    expect(title).toHaveFocus();
    expect(selected).toHaveBeenCalledWith(task.id);
    expect(selection.getSelectedTaskId()).toBe(task.id);
    expect(
      container.querySelector(`[data-task-id="${task.id}"]`),
    ).toHaveAttribute("data-selected", "true");

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Complete Interactive",
      }),
    );
    expect(completed).toHaveBeenCalledWith(task.id, true);

    fireEvent.keyDown(title, { key: "Backspace" });
    expect(deleted).toHaveBeenCalledWith(task.id);
  });

  it("does not render generated daily instances", () => {
    const store = createStore();
    store.createTask({ title: "Tree task" });
    store.createDailyTemplate("Daily task");
    render(
      <TaskTreeApp
        store={store}
        selection={new TaskSelection()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Tree task" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Daily task" }),
    ).not.toBeInTheDocument();
  });
});
