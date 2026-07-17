import { Notice, Plugin, WorkspaceLeaf } from "obsidian";

import {
  MILLER_TASK_INSPECTOR_VIEW_TYPE,
  MILLER_TASKS_VIEW_TYPE,
} from "./constants";
import { TaskPersistence } from "./data/TaskPersistence";
import { TaskStore } from "./domain/TaskStore";
import { TaskDraftBuffer } from "./state/TaskDraftBuffer";
import { TaskSelection } from "./state/TaskSelection";
import { MillerTaskInspectorView } from "./view/MillerTaskInspectorView";
import { MillerTasksView } from "./view/MillerTasksView";

export default class MillerTasksPlugin extends Plugin {
  private taskStore: TaskStore | null = null;
  private taskDrafts: TaskDraftBuffer | null = null;
  private readonly taskSelection = new TaskSelection();

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

    const taskStore = this.taskStore;
    const taskDrafts = new TaskDraftBuffer(taskStore);
    this.taskDrafts = taskDrafts;
    this.register(
      taskStore.subscribeToPersistenceErrors(() => {
        new Notice("Miller tasks could not save the latest changes.");
      }),
    );

    this.registerView(
      MILLER_TASKS_VIEW_TYPE,
      (leaf) =>
        new MillerTasksView(leaf, taskStore, (taskId) => {
          this.selectTask(taskId);
        }),
    );
    this.registerView(
      MILLER_TASK_INSPECTOR_VIEW_TYPE,
      (leaf) =>
        new MillerTaskInspectorView(
          leaf,
          taskStore,
          this.taskSelection,
          taskDrafts,
        ),
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

    this.addCommand({
      id: "toggle-completed-tasks",
      name: "Toggle completed tasks",
      callback: () => {
        const snapshot = taskStore.getSnapshot();
        taskStore.setShowCompleted(!snapshot.showCompleted);
      },
    });
  }

  override onunload(): void {
    this.taskDrafts?.flushAll();
    void this.taskStore?.flush().catch(() => undefined);
  }

  private selectTask(taskId: string | null): void {
    this.taskDrafts?.flushAll();
    this.taskSelection.setSelectedTaskId(taskId);
    if (taskId !== null) {
      void this.activateInspector();
    }
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
