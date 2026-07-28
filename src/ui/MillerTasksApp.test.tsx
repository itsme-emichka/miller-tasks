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
    const store = createStore();
    store.createTask({ title: "Plain task" });
    const { container } = render(<MillerTasksApp store={store} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Miller Tasks" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(container.querySelector(".miller-tasks-toolbar")).toBeNull();
    expect(container.querySelector(".miller-tasks-path")).toBeNull();
    expect(container.querySelector(".miller-tasks-inspector")).toBeNull();
    expect(
      screen.getByRole("region", { name: "Tasks for today" }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    const title = screen.getByRole("button", { name: "Plain task" });
    expect(title.tagName).toBe("SPAN");
    expect(
      title
        .closest(".miller-task-row")
        ?.querySelector(".task-list-item-checkbox"),
    ).toBeInstanceOf(HTMLInputElement);
  });

  it("adds a tree task to the pinned Today column from its row", () => {
    const store = createStore();
    store.createTask({ title: "Pin directly" });
    const { container } = render(<MillerTasksApp store={store} />);
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });

    expect(
      within(today).queryByRole("button", { name: "Pin directly" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Pin directly to today",
      }),
    );

    expect(
      within(today).getByRole("button", { name: "Pin directly" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Remove Pin directly from today",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      container.querySelector(".miller-today-column")
        ?.parentElement,
    ).toBe(container.querySelector(".miller-tasks-workspace"));
    expect(
      container.querySelector(".miller-tasks-columns")?.parentElement,
    ).toBe(container.querySelector(".miller-tasks-workspace"));
  });

  it("keeps Today and tree completion in sync", () => {
    const store = createStore();
    store.createTask({ title: "Shared task" });
    render(<MillerTasksApp store={store} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Shared task to today",
      }),
    );
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });

    fireEvent.click(
      within(today).getByRole("checkbox", {
        name: "Complete Shared task",
      }),
    );

    const todayRow = within(today)
      .getByRole("button", { name: "Shared task" })
      .closest(".miller-task-row");
    expect(todayRow).toHaveAttribute("data-completed", "true");
    expect(
      screen.queryByRole("button", {
        name: "Remove Shared task from today",
      }),
    ).not.toBeInTheDocument();
    expect(store.getTask("task-1")?.completed).toBe(true);
  });

  it("renders daily tasks below ordinary Today tasks with one divider", () => {
    const store = createStore();
    const template = store.createDailyTemplate("Daily routine");
    const ordinary = store.createTask({ title: "Specific task" });
    store.setTaskToday(ordinary.id, true);
    render(<MillerTasksApp store={store} />);
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });
    const rows = Array.from(
      today.querySelectorAll<HTMLElement>(".miller-task-row"),
    );
    const divider = today.querySelector(".miller-today-divider");

    expect(rows.map((row) => row.dataset.taskId)).toEqual([
      ordinary.id,
      store.getTasksForDailyTemplate(template.id)[0]!.id,
    ]);
    expect(divider).toHaveAttribute("role", "separator");
    expect(divider?.previousElementSibling).toBe(rows[0]);
    expect(divider?.nextElementSibling).toBe(rows[1]);
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

  it("leaves horizontal viewport movement under manual control", () => {
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollIntoView",
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const store = createStore();
      const parent = store.createTask({ title: "Parent" });
      store.createTask({ parentId: parent.id, title: "Child" });
      const { container } = render(<MillerTasksApp store={store} />);
      const columns = container.querySelector<HTMLElement>(
        ".miller-tasks-columns",
      )!;
      const today = container.querySelector<HTMLElement>(
        ".miller-today-column",
      )!;
      expect(columns.contains(today)).toBe(false);
      columns.scrollLeft = 73;

      const parentTitle = screen.getByRole("button", {
        name: "Parent",
      });
      fireEvent.click(parentTitle);
      fireEvent.keyDown(parentTitle, { key: "ArrowRight" });

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(columns.scrollLeft).toBe(73);
    } finally {
      if (originalScrollIntoView) {
        Object.defineProperty(
          Element.prototype,
          "scrollIntoView",
          originalScrollIntoView,
        );
      } else {
        Reflect.deleteProperty(Element.prototype, "scrollIntoView");
      }
    }
  });
});
