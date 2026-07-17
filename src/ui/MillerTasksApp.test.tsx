import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { MillerTasksApp } from "./MillerTasksApp";

function createStore(): TaskStore {
  let id = 0;
  return new TaskStore(createDefaultPluginData(), undefined, {
    idFactory: () => `task-${++id}`,
    now: () => id + 100,
  });
}

function createThroughInput(label: string, title: string): void {
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value: title } });
  fireEvent.submit(input.closest("form")!);
}

describe("MillerTasksApp", () => {
  it("keeps one shared heading and no visible column headings", () => {
    const { container } = render(
      <MillerTasksApp store={createStore()} />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Miller Tasks" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(container.querySelector(".miller-tasks-toolbar")).toBeNull();
    expect(container.querySelector(".miller-tasks-path")).toBeNull();
    expect(container.querySelector(".miller-tasks-inspector")).toBeNull();
  });

  it("creates a task, selects it, and opens its child column", () => {
    const store = createStore();
    const { container } = render(<MillerTasksApp store={store} />);

    expect(container.querySelectorAll(".miller-tasks-column")).toHaveLength(
      1,
    );
    createThroughInput("New root task", "Build prototype");

    fireEvent.click(
      screen.getByRole("button", { name: "Build prototype" }),
    );
    expect(container.querySelectorAll(".miller-tasks-column")).toHaveLength(
      2,
    );

    createThroughInput("New subtask", "Test navigation");
    expect(store.getChildren(store.getChildren(null)[0]!.id)).toHaveLength(
      1,
    );
    expect(
      screen.getByRole("button", { name: "Test navigation" }),
    ).toBeVisible();
  });

  it("renames inline and hides a completed task by default", () => {
    const store = createStore();
    store.createTask({ title: "Original" });
    render(<MillerTasksApp store={store} />);

    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Original" }),
    );
    const renameInput = screen.getByRole("textbox", {
      name: "Rename Original",
    });
    fireEvent.change(renameInput, { target: { value: "Renamed" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(
      screen.getByRole("button", { name: "Renamed" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Complete Renamed" }),
    );
    expect(
      screen.queryByRole("button", { name: "Renamed" }),
    ).not.toBeInTheDocument();
  });

  it("shows completed tasks when the store setting is enabled", () => {
    const store = createStore();
    const task = store.createTask({ title: "Completed" });
    store.completeSubtree(task.id, true);
    const { container } = render(<MillerTasksApp store={store} />);

    expect(
      screen.queryByRole("button", { name: "Completed" }),
    ).not.toBeInTheDocument();
    act(() => store.setShowCompleted(true));

    const row = screen
      .getByRole("button", { name: "Completed" })
      .closest(".miller-task-row");
    expect(row).toHaveAttribute("data-completed", "true");
    expect(
      within(row as HTMLElement).getByRole("checkbox"),
    ).toBeChecked();
    expect(container.querySelectorAll(".miller-tasks-column")).toHaveLength(
      1,
    );
  });

  it("preserves the selected task after a valid tree move", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Selected child",
    });
    const { container } = render(<MillerTasksApp store={store} />);

    fireEvent.click(screen.getByRole("button", { name: "Parent" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Selected child" }),
    );
    void act(() => store.moveTask(child.id, null));

    expect(
      screen
        .getByRole("button", { name: "Selected child" })
        .closest(".miller-task-row"),
    ).toHaveAttribute("data-selected", "true");
    expect(container.querySelectorAll(".miller-tasks-column")).toHaveLength(
      2,
    );
  });

  it("delegates completion when confirmation behavior is provided", () => {
    const store = createStore();
    store.createTask({ title: "Parent" });
    const completeTask = vi.fn();
    render(
      <MillerTasksApp
        store={store}
        onTaskCompletion={completeTask}
      />,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Complete Parent" }),
    );

    expect(completeTask).toHaveBeenCalledWith("task-1", true);
    expect(store.getTask("task-1")?.completed).toBe(false);
  });

  it("navigates rows and columns from the keyboard", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    store.createTask({ parentId: parent.id, title: "Child" });
    store.createTask({ title: "Sibling" });
    render(<MillerTasksApp store={store} />);

    const parentButton = screen.getByRole("button", {
      name: "Parent",
    });
    parentButton.focus();
    fireEvent.keyDown(parentButton, { key: "ArrowDown" });
    const siblingButton = screen.getByRole("button", {
      name: "Sibling",
    });
    expect(siblingButton).toHaveFocus();
    expect(siblingButton.closest(".miller-task-row")).toHaveAttribute(
      "data-selected",
      "true",
    );

    parentButton.focus();
    fireEvent.keyDown(parentButton, { key: "ArrowRight" });
    const childButton = screen.getByRole("button", { name: "Child" });
    expect(childButton).toHaveFocus();

    fireEvent.keyDown(childButton, { key: "ArrowLeft" });
    expect(parentButton).toHaveFocus();

    fireEvent.keyDown(parentButton, { key: "F2" });
    expect(
      screen.getByRole("textbox", { name: "Rename Parent" }),
    ).toHaveFocus();
  });
});
