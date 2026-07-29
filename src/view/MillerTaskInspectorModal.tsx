import { App, Modal } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";

import { TaskStore } from "../domain/TaskStore";
import { TaskDraftBuffer } from "../state/TaskDraftBuffer";
import { TaskSelection } from "../state/TaskSelection";
import { TaskAttachmentActions } from "../ui/attachmentActions";
import { DailyTemplateActions } from "../ui/dailyTemplateActions";
import { TaskInspectorApp } from "../ui/TaskInspectorApp";
import { TaskActions } from "../ui/taskActions";

export class MillerTaskInspectorModal extends Modal {
  private reactRoot: Root | null = null;

  constructor(
    app: App,
    private readonly taskStore: TaskStore,
    private readonly taskSelection: TaskSelection,
    private readonly taskDrafts: TaskDraftBuffer,
    private readonly attachmentActions: TaskAttachmentActions,
    private readonly dailyTemplateActions: DailyTemplateActions,
    private readonly taskActions: TaskActions,
    private readonly onClosed: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Task details");
    this.modalEl.addClass("miller-task-inspector-modal");
    this.contentEl.empty();
    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(
      <StrictMode>
        <TaskInspectorApp
          store={this.taskStore}
          selection={this.taskSelection}
          drafts={this.taskDrafts}
          attachmentActions={this.attachmentActions}
          dailyTemplateActions={this.dailyTemplateActions}
          taskActions={this.taskActions}
          showDailyTasks={false}
        />
      </StrictMode>,
    );
  }

  override onClose(): void {
    this.taskDrafts.flushAll();
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.empty();
    this.modalEl.removeClass("miller-task-inspector-modal");
    this.onClosed();
  }
}
