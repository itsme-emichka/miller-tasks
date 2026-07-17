import { ItemView, WorkspaceLeaf } from "obsidian";

import { MILLER_TASK_INSPECTOR_VIEW_TYPE } from "../constants";

export class MillerTaskInspectorView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
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
    this.contentEl.createEl("p", {
      text: "Select a task.",
      cls: "miller-task-inspector-empty",
    });
  }

  override async onClose(): Promise<void> {
    this.contentEl.removeClass("miller-task-inspector-view");
  }
}
