import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { TaskDraftBuffer } from "../state/TaskDraftBuffer";
import { TaskSelection } from "../state/TaskSelection";
import { TaskAttachmentActions } from "./attachmentActions";
import { TaskInspectorApp } from "./TaskInspectorApp";

function renderInspector(
  attachmentActions?: TaskAttachmentActions,
): {
  store: TaskStore;
  selection: TaskSelection;
  drafts: TaskDraftBuffer;
  taskId: string;
} {
  const store = new TaskStore(
    createDefaultPluginData(),
    undefined,
    {
      idFactory: () => "task-1",
      now: () => new Date(2026, 6, 17, 15).getTime(),
    },
  );
  const task = store.createTask({ title: "Ship beta" });
  const selection = new TaskSelection();
  const drafts = new TaskDraftBuffer(store);
  selection.setSelectedTaskId(task.id);
  render(
    <TaskInspectorApp
      store={store}
      selection={selection}
      drafts={drafts}
      attachmentActions={attachmentActions}
    />,
  );
  return { store, selection, drafts, taskId: task.id };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskInspectorApp", () => {
  it("shows the selected task and saves text after 400ms", () => {
    vi.useFakeTimers();
    const { store, taskId } = renderInspector();

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Ready for review" },
    });
    expect(store.getTask(taskId)?.description).toBe("");

    void act(() => vi.advanceTimersByTime(399));
    expect(store.getTask(taskId)?.description).toBe("");
    void act(() => vi.advanceTimersByTime(1));
    expect(store.getTask(taskId)?.description).toBe(
      "Ready for review",
    );
  });

  it("flushes text on blur and normalizes tags", () => {
    const { store, taskId } = renderInspector();
    const tags = screen.getByLabelText("Tags");

    fireEvent.change(tags, {
      target: { value: "#work, next, work" },
    });
    fireEvent.blur(tags);

    expect(store.getTask(taskId)?.tags).toEqual(["work", "next"]);
  });

  it("rejects non-http URLs and saves task metadata", () => {
    const { store, taskId } = renderInspector();
    const url = screen.getByLabelText("URL");

    fireEvent.change(url, { target: { value: "obsidian://open" } });
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Use an absolute http or https URL."),
    ).toBeVisible();
    expect(store.getTask(taskId)?.url).toBeNull();

    fireEvent.change(screen.getByLabelText("Priority"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByLabelText("Flagged"));
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-07-18" },
    });
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "09:30" },
    });

    expect(store.getTask(taskId)).toMatchObject({
      priority: "high",
      flagged: true,
      dueDate: "2026-07-18",
      dueTime: "09:30",
    });
  });

  it("switches with shared selection state", () => {
    const { store, selection } = renderInspector();
    const other = store.createTask({
      id: "task-2",
      title: "Second task",
    });

    act(() => selection.setSelectedTaskId(other.id));
    expect(screen.getByText("Second task")).toBeVisible();

    act(() => selection.setSelectedTaskId(null));
    expect(screen.getByText("Select a task.")).toBeVisible();
  });

  it("pastes, opens, and removes image attachments", async () => {
    const addFiles = vi.fn(async () => undefined);
    const openAttachment = vi.fn(async () => undefined);
    const removeAttachment = vi.fn(async () => undefined);
    const actions: TaskAttachmentActions = {
      addFiles,
      getResourceUrl: () => "app://vault/image.png",
      openAttachment,
      removeAttachment,
    };
    const { store, taskId } = renderInspector(actions);
    const attachment = {
      id: "image-1",
      path: "Miller Tasks/Attachments/task-1/image.png",
      name: "image.png",
      mimeType: "image/png",
      createdAt: 1,
    };
    act(() => {
      store.addAttachment(taskId, attachment);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open image.png" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove image.png" }),
    );
    expect(openAttachment).toHaveBeenCalledWith(attachment);
    expect(removeAttachment).toHaveBeenCalledWith(taskId, attachment);

    const pasted = new File(["image"], "pasted.png", {
      type: "image/png",
    });
    fireEvent.paste(
      screen
        .getByRole("button", { name: "Open image.png" })
        .closest("form")!,
      {
        clipboardData: {
          files: [pasted],
        },
      },
    );
    await waitFor(() =>
      expect(addFiles).toHaveBeenCalledWith(taskId, [pasted]),
    );
  });
});
