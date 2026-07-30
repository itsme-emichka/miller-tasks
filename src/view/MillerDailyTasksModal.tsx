import { App, Modal } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";

import { TaskStore } from "../domain/TaskStore";
import { DailyTasksApp } from "../ui/DailyTasksApp";
import type { DailyTemplateActions } from "../ui/dailyTemplateActions";

export class MillerDailyTasksModal extends Modal {
  private reactRoot: Root | null = null;

  constructor(
    app: App,
    private readonly taskStore: TaskStore,
    private readonly dailyTemplateActions: DailyTemplateActions,
    private readonly onClosed: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("Daily tasks");
    this.modalEl.addClass("miller-daily-tasks-modal");
    this.contentEl.empty();
    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(
      <StrictMode>
        <DailyTasksApp
          store={this.taskStore}
          actions={this.dailyTemplateActions}
        />
      </StrictMode>,
    );
  }

  override onClose(): void {
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.empty();
    this.modalEl.removeClass("miller-daily-tasks-modal");
    this.onClosed();
  }
}
