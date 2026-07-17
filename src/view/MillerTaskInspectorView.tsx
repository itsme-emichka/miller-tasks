import { ItemView, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";

import { MILLER_TASK_INSPECTOR_VIEW_TYPE } from "../constants";
import { TaskStore } from "../domain/TaskStore";
import { TaskDraftBuffer } from "../state/TaskDraftBuffer";
import { TaskSelection } from "../state/TaskSelection";
import { TaskAttachmentActions } from "../ui/attachmentActions";
import { TaskInspectorApp } from "../ui/TaskInspectorApp";

export class MillerTaskInspectorView extends ItemView {
  private reactRoot: Root | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly taskStore: TaskStore,
    private readonly taskSelection: TaskSelection,
    private readonly taskDrafts: TaskDraftBuffer,
    private readonly attachmentActions: TaskAttachmentActions,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return MILLER_TASK_INSPECTOR_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "Task details";
  }

  override getIcon(): string {
    return "panel-right";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("miller-task-inspector-view");
    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(
      <StrictMode>
        <TaskInspectorApp
          store={this.taskStore}
          selection={this.taskSelection}
          drafts={this.taskDrafts}
          attachmentActions={this.attachmentActions}
        />
      </StrictMode>,
    );
  }

  override async onClose(): Promise<void> {
    this.taskDrafts.flushAll();
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.removeClass("miller-task-inspector-view");
  }
}
