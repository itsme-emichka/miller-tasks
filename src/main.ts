import { Notice, Plugin, WorkspaceLeaf } from "obsidian";

import {
  MILLER_TASK_INSPECTOR_VIEW_TYPE,
  MILLER_TASKS_VIEW_TYPE,
} from "./constants";
import { TaskPersistence } from "./data/TaskPersistence";
import { TaskStore } from "./domain/TaskStore";
import { MillerTaskInspectorView } from "./view/MillerTaskInspectorView";
import { MillerTasksView } from "./view/MillerTasksView";

export default class MillerTasksPlugin extends Plugin {
  private taskStore: TaskStore | null = null;

  override async onload(): Promise<void> {
    const persistence = new TaskPersistence(
      () => this.loadData(),
      (data) => this.saveData(data),
    );

    try {
      this.taskStore = new TaskStore(
        await persistence.load(),
        persistence,
      );
    } catch (error) {
      new Notice(
        "Miller tasks data is invalid. The plugin was not loaded to protect your tasks.",
      );
      throw error;
    }

    this.registerView(
      MILLER_TASKS_VIEW_TYPE,
      (leaf) => new MillerTasksView(leaf),
    );
    this.registerView(
      MILLER_TASK_INSPECTOR_VIEW_TYPE,
      (leaf) => new MillerTaskInspectorView(leaf),
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

    this.addCommand({
      id: "open-task-details",
      name: "Open task details",
      callback: () => {
        void this.activateInspector();
      },
    });
  }

  override onunload(): void {
    void this.taskStore?.flush().catch(() => undefined);
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

  private async activateInspector(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null | undefined =
      workspace.getLeavesOfType(MILLER_TASK_INSPECTOR_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        return;
      }

      await leaf.setViewState({
        type: MILLER_TASK_INSPECTOR_VIEW_TYPE,
        active: true,
      });
    }

    await workspace.revealLeaf(leaf);
  }
}
