import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { MillerTasksApp } from "./MillerTasksApp";

function createStore(): TaskStore {
  let id = 0;
  return new TaskStore(createDefaultPluginData(), undefined, {
    idFactory: () => `task-${++id}`,
    now: () => Date.now(),
  });
}

function createThroughInput(label: string, title: string): void {
  const input = screen.getByRole("textbox", { name: label });
  fireEvent.change(input, { target: { value: title } });
  fireEvent.submit(input.closest("form")!);
}

function createRect(
  x: number,
  y: number,
  width: number,
  height: number,
): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    right: x + width,
    bottom: y + height,
    left: x,
    toJSON: () => ({}),
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

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

  it("switches to the task tree from the icon left of the heading", () => {
    const toggleView = vi.fn();
    const { container } = render(
      <MillerTasksApp
        store={createStore()}
        onToggleView={toggleView}
      />,
    );
    const header = container.querySelector(".miller-view-header");
    const toggle = screen.getByRole("button", {
      name: "Show task tree",
    });

    expect(header?.firstElementChild).toBe(toggle);
    expect(toggle.nextElementSibling).toBe(
      screen.getByRole("heading", { name: "Miller Tasks" }),
    );
    fireEvent.click(toggle);
    expect(toggleView).toHaveBeenCalledOnce();
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
    ).toHaveAttribute("aria-pressed", "true");
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

  it("renders completed Today tasks after incomplete peers", () => {
    const store = createStore();
    const completed = store.createTask({ title: "Already done" });
    store.setTaskToday(completed.id, true);
    store.completeSubtree(completed.id, true);
    const open = store.createTask({ title: "Still open" });
    store.setTaskToday(open.id, true);
    render(<MillerTasksApp store={store} />);
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });
    const rows = Array.from(
      today.querySelectorAll<HTMLElement>(".miller-task-row"),
    );

    expect(rows.map((row) => row.dataset.taskId)).toEqual([
      open.id,
      completed.id,
    ]);
  });

  it("collapses completed Today tasks from the desktop disclosure", () => {
    const store = createStore();
    const completed = store.createTask({ title: "Finished today" });
    store.setTaskToday(completed.id, true);
    store.completeSubtree(completed.id, true);
    const open = store.createTask({ title: "Open today" });
    store.setTaskToday(open.id, true);
    render(
      <MillerTasksApp store={store} compactLayout={false} />,
    );
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });
    const disclosure = within(today).getByRole("button", {
      name: "Hide completed tasks",
    });

    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(
      within(today).getByRole("button", { name: "Finished today" }),
    ).toBeVisible();
    fireEvent.click(disclosure);

    expect(
      within(today).queryByRole("button", {
        name: "Finished today",
      }),
    ).not.toBeInTheDocument();
    expect(
      within(today).getByRole("button", { name: "Open today" }),
    ).toBeVisible();
    expect(
      within(today).getByRole("button", {
        name: "Show 1 completed task",
      }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("hides completed Today tasks behind the compact disclosure", () => {
    const store = createStore();
    const completed = store.createTask({ title: "Finished today" });
    store.setTaskToday(completed.id, true);
    store.completeSubtree(completed.id, true);
    const open = store.createTask({ title: "Open today" });
    store.setTaskToday(open.id, true);
    render(<MillerTasksApp store={store} compactLayout />);
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });
    const sheetHandle = within(today).getByRole("button", {
      name: "Open Today, 1 open task",
    });

    expect(today).toHaveAttribute("data-open", "false");
    expect(sheetHandle).toHaveAttribute("aria-expanded", "false");
    expect(
      today.querySelector(".miller-today-sheet-content"),
    ).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(sheetHandle);
    expect(today).toHaveAttribute("data-open", "true");
    expect(sheetHandle).toHaveAttribute("aria-expanded", "true");

    expect(
      within(today).getByRole("button", { name: "Open today" }),
    ).toBeVisible();
    expect(
      within(today).queryByRole("button", {
        name: "Finished today",
      }),
    ).not.toBeInTheDocument();

    const disclosure = within(today).getByRole("button", {
      name: "Show 1 completed task",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);

    expect(
      within(today).getByRole("button", {
        name: "Finished today",
      }),
    ).toBeVisible();
    expect(disclosure).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(disclosure);
    expect(
      within(today).queryByRole("button", {
        name: "Finished today",
      }),
    ).not.toBeInTheDocument();
  });

  it("opens and closes the compact Today sheet by swipe", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const store = createStore();
    const task = store.createTask({ title: "Swipe target" });
    store.setTaskToday(task.id, true);
    const { container } = render(
      <MillerTasksApp store={store} compactLayout />,
    );
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });
    const handle = within(today).getByRole("button", {
      name: "Open Today, 1 open task",
    });
    const columns = container.querySelector(".miller-tasks-columns");

    expect(today).toHaveAttribute("data-open", "false");
    expect(columns?.parentElement).toBe(
      container.querySelector(".miller-tasks-workspace"),
    );
    expect(
      container.querySelector(".miller-mobile-workspace-divider"),
    ).toBeNull();

    fireEvent.pointerDown(handle, {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientY: 700,
    });
    fireEvent.pointerMove(handle, {
      isPrimary: true,
      pointerId: 1,
      clientY: 620,
    });
    fireEvent.pointerUp(handle, {
      isPrimary: true,
      pointerId: 1,
      clientY: 620,
    });

    expect(today).toHaveAttribute("data-open", "true");
    expect(handle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(today).getByRole("button", { name: "Swipe target" }),
    ).toBeVisible();

    fireEvent.pointerDown(handle, {
      button: 0,
      isPrimary: true,
      pointerId: 2,
      clientY: 200,
    });
    fireEvent.pointerMove(handle, {
      isPrimary: true,
      pointerId: 2,
      clientY: 280,
    });
    fireEvent.pointerUp(handle, {
      isPrimary: true,
      pointerId: 2,
      clientY: 280,
    });

    expect(today).toHaveAttribute("data-open", "false");
    expect(handle).toHaveAttribute("aria-expanded", "false");
    expect(
      today.querySelector(".miller-today-sheet-content"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the compact Today sheet above Obsidian's mobile navbar", () => {
    const getBoundingClientRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("miller-tasks-workspace")) {
          return createRect(0, 100, 375, 700);
        }
        if (this.classList.contains("mobile-navbar")) {
          return createRect(0, 700, 375, 100);
        }
        return createRect(0, 0, 0, 0);
      });

    const { container, unmount } = render(
      <>
        <nav className="mobile-navbar" />
        <MillerTasksApp store={createStore()} compactLayout />
      </>,
    );
    const workspace = container.querySelector<HTMLElement>(
      ".miller-tasks-workspace",
    );

    expect(
      workspace?.style.getPropertyValue(
        "--miller-mobile-navbar-inset",
      ),
    ).toBe("108px");

    unmount();
    getBoundingClientRect.mockRestore();
  });

  it("contains Today and hierarchy touch gestures inside the compact view", () => {
    vi.stubGlobal("PointerEvent", MouseEvent);
    const pointerGesture = vi.fn();
    const touchGesture = vi.fn();
    const store = createStore();
    const task = store.createTask({ title: "Gesture target" });
    store.setTaskToday(task.id, true);
    const { container } = render(
      <div
        onPointerDown={pointerGesture}
        onPointerMove={pointerGesture}
        onPointerUp={pointerGesture}
        onTouchStart={touchGesture}
        onTouchMove={touchGesture}
        onTouchEnd={touchGesture}
      >
        <MillerTasksApp store={store} compactLayout />
      </div>,
    );
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });
    const handle = within(today).getByRole("button", {
      name: "Open Today, 1 open task",
    });

    fireEvent.pointerDown(handle, {
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientY: 700,
    });
    fireEvent.pointerUp(handle, {
      isPrimary: true,
      pointerId: 1,
      clientY: 700,
    });
    fireEvent.click(handle);

    expect(today).toHaveAttribute("data-open", "true");
    expect(pointerGesture).not.toHaveBeenCalled();

    const handleTouchMove = createEvent.touchMove(handle, {
      cancelable: true,
      touches: [{ clientX: 180, clientY: 660 }],
    });
    fireEvent(handle, handleTouchMove);
    expect(handleTouchMove.defaultPrevented).toBe(true);
    expect(touchGesture).not.toHaveBeenCalled();

    const columns = container.querySelector<HTMLElement>(
      ".miller-tasks-columns",
    );
    expect(columns).not.toBeNull();
    const columnTouchMove = createEvent.touchMove(columns!, {
      cancelable: true,
      touches: [{ clientX: 120, clientY: 300 }],
    });
    fireEvent.touchStart(columns!, {
      touches: [{ clientX: 200, clientY: 300 }],
    });
    fireEvent(columns!, columnTouchMove);
    fireEvent.touchEnd(columns!, {
      changedTouches: [{ clientX: 120, clientY: 300 }],
    });

    expect(columnTouchMove.defaultPrevented).toBe(false);
    expect(touchGesture).not.toHaveBeenCalled();
  });

  it("adds only recursive leaf descendants when a parent enters Today", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    const directLeaf = store.createTask({
      parentId: parent.id,
      title: "Direct leaf",
    });
    const branch = store.createTask({
      parentId: parent.id,
      title: "Branch",
    });
    const nestedLeaf = store.createTask({
      parentId: branch.id,
      title: "Nested leaf",
    });
    render(<MillerTasksApp store={store} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Add Parent to today",
      }),
    );
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });

    expect(
      within(today).queryByRole("button", { name: "Parent" }),
    ).not.toBeInTheDocument();
    expect(
      within(today).queryByRole("button", { name: "Branch" }),
    ).not.toBeInTheDocument();
    expect(
      within(today).getByRole("button", { name: "Direct leaf" }),
    ).toBeVisible();
    expect(
      within(today).getByRole("button", { name: "Nested leaf" }),
    ).toBeVisible();
    expect(store.getTask(directLeaf.id)?.today).toBe(true);
    expect(store.getTask(nestedLeaf.id)?.today).toBe(true);
    expect(
      screen.getByRole("button", {
        name: "Remove Parent from today",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a quiet direct-parent label below a Today subtask", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Project parent" });
    const child = store.createTask({
      parentId: parent.id,
      title: "Concrete step",
    });
    store.setTaskToday(child.id, true);
    render(<MillerTasksApp store={store} />);
    const today = screen.getByRole("region", {
      name: "Tasks for today",
    });
    const parentLabel = within(today).getByText("Project parent");

    expect(parentLabel).toHaveClass("miller-today-parent");
    expect(
      within(today).getByRole("button", { name: "Concrete step" }),
    ).toBeVisible();
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

  it("opens the sidebar on wide click and a popup on compact hold", () => {
    vi.useFakeTimers();
    vi.stubGlobal("PointerEvent", MouseEvent);
    const store = createStore();
    store.createTask({ title: "Inspect me" });
    const requestInspector = vi.fn();
    const { rerender } = render(
      <MillerTasksApp
        store={store}
        compactLayout={false}
        onTaskInspectorRequested={requestInspector}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect me" }),
    );
    expect(requestInspector).toHaveBeenLastCalledWith(
      "task-1",
      "sidebar",
    );

    rerender(
      <MillerTasksApp
        store={store}
        compactLayout
        onTaskInspectorRequested={requestInspector}
      />,
    );
    const title = screen.getByRole("button", { name: "Inspect me" });
    fireEvent.click(title);
    expect(requestInspector).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(title, {
      button: 0,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    fireEvent.pointerMove(title, {
      isPrimary: true,
      clientX: 40,
      clientY: 20,
    });
    void act(() => vi.advanceTimersByTime(550));
    fireEvent.pointerUp(title);
    expect(requestInspector).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(title, {
      button: 0,
      isPrimary: true,
      clientX: 20,
      clientY: 20,
    });
    void act(() => vi.advanceTimersByTime(549));
    expect(requestInspector).toHaveBeenCalledTimes(1);
    void act(() => vi.advanceTimersByTime(1));
    fireEvent.pointerUp(title);
    fireEvent.click(title);

    expect(requestInspector).toHaveBeenCalledTimes(2);
    expect(requestInspector).toHaveBeenLastCalledWith(
      "task-1",
      "popup",
    );
  });

  it("switches compact presentation with the window width", () => {
    const originalWidth = window.innerWidth;
    try {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: 900,
      });
      const { container } = render(
        <MillerTasksApp store={createStore()} />,
      );
      const shell = container.querySelector(".miller-tasks-shell");
      expect(shell).toHaveAttribute("data-compact", "false");

      act(() => {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: 600,
        });
        window.dispatchEvent(new Event("resize"));
      });
      expect(shell).toHaveAttribute("data-compact", "true");

      act(() => {
        Object.defineProperty(window, "innerWidth", {
          configurable: true,
          value: 900,
        });
        window.dispatchEvent(new Event("resize"));
      });
      expect(shell).toHaveAttribute("data-compact", "false");
    } finally {
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalWidth,
      });
    }
  });

  it("keeps a completed row struck through until the next day", () => {
    let now = new Date(2026, 6, 18, 10).getTime();
    let id = 0;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `task-${++id}`,
        now: () => now,
      },
    );
    store.createTask({ title: "Original" });
    const { rerender } = render(
      <MillerTasksApp store={store} clock={() => now} />,
    );

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
    const completedRow = screen
      .getByRole("button", { name: "Renamed" })
      .closest(".miller-task-row");
    expect(completedRow).toHaveAttribute("data-completed", "true");

    now = new Date(2026, 6, 19, 0, 1).getTime();
    rerender(<MillerTasksApp store={store} clock={() => now} />);
    expect(
      screen.queryByRole("button", { name: "Renamed" }),
    ).not.toBeInTheDocument();
  });

  it("shows completed tasks when the store setting is enabled", () => {
    let id = 0;
    const yesterday = Date.now() - 24 * 60 * 60 * 1_000;
    const store = new TaskStore(
      createDefaultPluginData(),
      undefined,
      {
        idFactory: () => `task-${++id}`,
        now: () => yesterday,
      },
    );
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

  it("marks only the deepest selected path item as active", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Path parent" });
    store.createTask({
      parentId: parent.id,
      title: "Current child",
    });
    render(<MillerTasksApp store={store} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Path parent" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Current child" }),
    );

    const parentRow = screen
      .getByRole("button", { name: "Path parent" })
      .closest(".miller-task-row");
    const childRow = screen
      .getByRole("button", { name: "Current child" })
      .closest(".miller-task-row");
    expect(parentRow).toHaveAttribute("data-selected", "true");
    expect(parentRow).toHaveAttribute("data-active", "false");
    expect(childRow).toHaveAttribute("data-selected", "true");
    expect(childRow).toHaveAttribute("data-active", "true");
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

  it("deletes the focused row with Delete or Backspace", () => {
    const store = createStore();
    store.createTask({ title: "Delete me" });
    store.createTask({ title: "Backspace me" });
    const deleteTask = vi.fn();
    render(
      <MillerTasksApp
        store={store}
        onTaskDelete={deleteTask}
      />,
    );

    const first = screen.getByRole("button", { name: "Delete me" });
    fireEvent.click(first);
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "Delete" });

    const second = screen.getByRole("button", {
      name: "Backspace me",
    });
    fireEvent.click(second);
    fireEvent.keyDown(second, { key: "Backspace" });

    expect(deleteTask).toHaveBeenNthCalledWith(1, "task-1");
    expect(deleteTask).toHaveBeenNthCalledWith(2, "task-2");
  });

  it("does not delete while a title or new-task field is edited", () => {
    const store = createStore();
    store.createTask({ title: "Keep editing" });
    const deleteTask = vi.fn();
    render(
      <MillerTasksApp
        store={store}
        onTaskDelete={deleteTask}
      />,
    );

    fireEvent.doubleClick(
      screen.getByRole("button", { name: "Keep editing" }),
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", {
        name: "Rename Keep editing",
      }),
      { key: "Backspace" },
    );
    fireEvent.keyDown(
      screen.getByRole("textbox", { name: "New root task" }),
      { key: "Delete" },
    );

    expect(deleteTask).not.toHaveBeenCalled();
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
