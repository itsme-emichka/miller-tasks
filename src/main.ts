import { Plugin, WorkspaceLeaf } from "obsidian";

import { MILLER_TASKS_VIEW_TYPE } from "./constants";
import { MillerTasksView } from "./view/MillerTasksView";

export default class MillerTasksPlugin extends Plugin {
  override async onload(): Promise<void> {
    this.registerView(
      MILLER_TASKS_VIEW_TYPE,
      (leaf) => new MillerTasksView(leaf),
    );

    this.addRibbonIcon("list-tree", "Open miller tasks", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-task-browser",
      name: "Open task browser",
      callback: () => {
        void this.activateView();
      },
    });
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | undefined =
      workspace.getLeavesOfType(MILLER_TASKS_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: MILLER_TASKS_VIEW_TYPE,
        active: true,
      });
    }

    await workspace.revealLeaf(leaf);
  }
}
