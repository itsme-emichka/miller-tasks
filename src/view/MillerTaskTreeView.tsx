import { ItemView, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";

import { MILLER_TASK_TREE_VIEW_TYPE } from "../constants";
import { TaskStore } from "../domain/TaskStore";
import { TaskSelection } from "../state/TaskSelection";
import { TaskTreeApp } from "../ui/TaskTreeApp";

interface MillerTaskTreeActions {
  toggleView: () => void;
  completeTask: (taskId: string, completed: boolean) => void;
  deleteTask: (taskId: string) => void;
}

export class MillerTaskTreeView extends ItemView {
  private reactRoot: Root | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly taskStore: TaskStore,
    private readonly taskSelection: TaskSelection,
    private readonly onTaskSelected: (taskId: string) => void,
    private readonly actions: MillerTaskTreeActions,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return MILLER_TASK_TREE_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Miller task tree";
  }

  override getIcon(): string {
    return "git-fork";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("miller-task-tree-view");
    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(
      <StrictMode>
        <TaskTreeApp
          store={this.taskStore}
          selection={this.taskSelection}
          onToggleView={this.actions.toggleView}
          onTaskSelected={this.onTaskSelected}
          onTaskCompletion={this.actions.completeTask}
          onTaskDelete={this.actions.deleteTask}
        />
      </StrictMode>,
    );
  }

  override async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.removeClass("miller-task-tree-view");
  }
}
