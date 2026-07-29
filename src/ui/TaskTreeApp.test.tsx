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
  it("switches back to columns from the icon left of the heading", () => {
    const toggleView = vi.fn();
    const { container } = render(
      <TaskTreeApp
        store={createStore()}
        selection={new TaskSelection()}
        onToggleView={toggleView}
      />,
    );
    const header = container.querySelector(".miller-view-header");
    const toggle = screen.getByRole("button", {
      name: "Show Miller columns",
    });

    expect(header?.firstElementChild).toBe(toggle);
    expect(toggle.nextElementSibling).toBe(
      screen.getByRole("heading", { name: "Miller Tasks" }),
    );
    fireEvent.click(toggle);
    expect(toggleView).toHaveBeenCalledOnce();
  });

  it("zooms only from explicit controls or a modified wheel", () => {
    const store = createStore();
    store.createTask({ title: "Zoomable" });
    const { container } = render(
      <TaskTreeApp
        store={store}
        selection={new TaskSelection()}
      />,
    );
    const zoomValue = screen.getByRole("button", {
      name: "Reset tree zoom",
    });
    const viewport = screen.getByRole("region", {
      name: "Task tree",
    });

    expect(zoomValue).toHaveTextContent("100%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoomValue).toHaveTextContent("90%");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoomValue).toHaveTextContent("100%");

    fireEvent.wheel(viewport, { deltaY: 100 });
    expect(zoomValue).toHaveTextContent("100%");
    fireEvent.wheel(viewport, { ctrlKey: true, deltaY: 100 });
    expect(zoomValue).toHaveTextContent("90%");
    expect(
      container.querySelector<HTMLElement>(
        ".miller-task-tree-canvas",
      )?.style.transform,
    ).toBe("scale(0.9)");
  });

  it("fits the complete tree inside the current viewport", () => {
    const store = createStore();
    const parent = store.createTask({ title: "Parent" });
    store.createTask({ parentId: parent.id, title: "Child one" });
    store.createTask({ parentId: parent.id, title: "Child two" });
    const { container } = render(
      <TaskTreeApp
        store={store}
        selection={new TaskSelection()}
      />,
    );
    const viewport = screen.getByRole("region", {
      name: "Task tree",
    });
    Object.defineProperties(viewport, {
      clientWidth: { configurable: true, value: 160 },
      clientHeight: { configurable: true, value: 100 },
    });

    fireEvent.click(screen.getByRole("button", { name: "Fit" }));

    const percentage = Number.parseInt(
      screen
        .getByRole("button", { name: "Reset tree zoom" })
        .textContent ?? "100",
      10,
    );
    expect(percentage).toBeLessThan(100);
    expect(
      Number.parseFloat(
        container.querySelector<HTMLElement>(
          ".miller-task-tree-zoom-surface",
        )!.style.width,
      ),
    ).toBeLessThan(160);
  });

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
