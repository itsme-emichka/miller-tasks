import { ItemView, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";

import { MILLER_TASKS_VIEW_TYPE } from "../constants";
import { TaskStore } from "../domain/TaskStore";
import { MillerTasksApp } from "../ui/MillerTasksApp";

interface MillerTasksActions {
  completeTask: (taskId: string, completed: boolean) => void;
  reportMoveError: (message: string) => void;
}

export class MillerTasksView extends ItemView {
  private reactRoot: Root | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly taskStore: TaskStore,
    private readonly onTaskSelected: (taskId: string | null) => void,
    private readonly actions: MillerTasksActions,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return MILLER_TASKS_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Miller tasks";
  }

  override getIcon(): string {
    return "list-tree";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("miller-tasks-view");

    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(
      <StrictMode>
        <MillerTasksApp
          store={this.taskStore}
          onTaskSelected={this.onTaskSelected}
          onTaskCompletion={this.actions.completeTask}
          onTaskMoveError={this.actions.reportMoveError}
        />
      </StrictMode>,
    );
  }

  override async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.removeClass("miller-tasks-view");
  }
}
