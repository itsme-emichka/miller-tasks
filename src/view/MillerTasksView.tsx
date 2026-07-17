import { ItemView, WorkspaceLeaf } from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";

import { MILLER_TASKS_VIEW_TYPE } from "../constants";
import { MillerTasksApp } from "../ui/MillerTasksApp";

export class MillerTasksView extends ItemView {
  private reactRoot: Root | null = null;

  constructor(leaf: WorkspaceLeaf) {
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
        <MillerTasksApp />
      </StrictMode>,
    );
  }

  override async onClose(): Promise<void> {
    this.reactRoot?.unmount();
    this.reactRoot = null;
    this.contentEl.removeClass("miller-tasks-view");
  }
}
