import { Notice, Plugin, WorkspaceLeaf } from "obsidian";

import {
  MILLER_TASK_INSPECTOR_VIEW_TYPE,
  MILLER_TASKS_VIEW_TYPE,
} from "./constants";
import { TaskAttachmentService } from "./data/TaskAttachmentService";
import { TaskPersistence } from "./data/TaskPersistence";
import { TaskStore } from "./domain/TaskStore";
import { TaskDraftBuffer } from "./state/TaskDraftBuffer";
import { TaskSelection } from "./state/TaskSelection";
import { TaskAttachment } from "./domain/task";
import { requestConfirmation } from "./view/ConfirmationModal";
import { MillerTaskInspectorView } from "./view/MillerTaskInspectorView";
import { MillerTasksView } from "./view/MillerTasksView";

export default class MillerTasksPlugin extends Plugin {
  private taskStore: TaskStore | null = null;
  private taskDrafts: TaskDraftBuffer | null = null;
  private attachmentService: TaskAttachmentService | null = null;
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
    const attachmentService = new TaskAttachmentService(
      this.app,
      taskStore,
    );
    this.taskDrafts = taskDrafts;
    this.attachmentService = attachmentService;
    this.register(
      taskStore.subscribeToPersistenceErrors(() => {
        new Notice("Miller tasks could not save the latest changes.");
      }),
    );

    this.registerView(
      MILLER_TASKS_VIEW_TYPE,
      (leaf) =>
        new MillerTasksView(
          leaf,
          taskStore,
          (taskId) => {
            this.selectTask(taskId);
          },
          {
            completeTask: (taskId, completed) => {
              void this.completeTask(taskId, completed);
            },
            reportMoveError: (message) => {
              new Notice(message);
            },
          },
        ),
    );
    this.registerView(
      MILLER_TASK_INSPECTOR_VIEW_TYPE,
      (leaf) =>
        new MillerTaskInspectorView(
          leaf,
          taskStore,
          this.taskSelection,
          taskDrafts,
          {
            addFiles: async (taskId, files) => {
              taskDrafts.flush(taskId);
              const result = await attachmentService.addFiles(
                taskId,
                files,
              );
              if (result.errors.length > 0) {
                new Notice(
                  `${result.errors.length} image` +
                    `${result.errors.length === 1 ? "" : "s"} could not be added.`,
                );
                throw new Error("Some images could not be added.");
              }
            },
            getResourceUrl: (attachment) =>
              attachmentService.getResourceUrl(attachment),
            openAttachment: (attachment) =>
              attachmentService.openAttachment(attachment),
            removeAttachment: (taskId, attachment) =>
              this.removeAttachment(taskId, attachment),
          },
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

    this.addCommand({
      id: "delete-selected-task",
      name: "Delete selected task",
      callback: () => {
        void this.deleteSelectedTask();
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

  private async completeTask(
    taskId: string,
    completed: boolean,
  ): Promise<void> {
    const taskStore = this.taskStore;
    const task = taskStore?.getTask(taskId);
    if (!taskStore || !task) {
      return;
    }

    if (
      completed &&
      taskStore.getSubtreeSize(taskId) > 1 &&
      !(await requestConfirmation(this.app, {
        title: "Complete task and subtasks?",
        message:
          `"${task.title}" has subtasks. This will complete the ` +
          "entire subtree.",
        confirmLabel: "Complete all",
      }))
    ) {
      return;
    }

    taskStore.completeSubtree(taskId, completed);
  }

  private async deleteSelectedTask(): Promise<void> {
    const taskStore = this.taskStore;
    const taskId = this.taskSelection.getSelectedTaskId();
    const task = taskId ? taskStore?.getTask(taskId) : undefined;
    if (!taskStore || !task) {
      new Notice("Select a task to delete.");
      return;
    }

    const subtreeSize = taskStore.getSubtreeSize(task.id);
    const confirmed = await requestConfirmation(this.app, {
      title: "Delete task?",
      message:
        subtreeSize === 1
          ? `"${task.title}" will be deleted.`
          : `"${task.title}" and ${subtreeSize - 1} subtasks will be deleted.`,
      confirmLabel: "Delete",
    });
    if (!confirmed) {
      return;
    }

    this.taskDrafts?.flushAll();
    try {
      await this.attachmentService?.trashTaskAttachments(
        taskStore.getSubtree(task.id),
      );
    } catch {
      new Notice(
        "The task was not deleted because its images could not be moved to trash.",
      );
      return;
    }
    taskStore.deleteSubtree(task.id);
    this.taskSelection.setSelectedTaskId(null);
  }

  private async removeAttachment(
    taskId: string,
    attachment: TaskAttachment,
  ): Promise<void> {
    const attachmentService = this.attachmentService;
    if (!attachmentService) {
      return;
    }

    this.taskDrafts?.flush(taskId);
    const confirmed = await requestConfirmation(this.app, {
      title: "Remove image?",
      message: `"${attachment.name}" will be moved to Obsidian's trash.`,
      confirmLabel: "Remove",
    });
    if (confirmed) {
      await attachmentService.removeAttachment(
        taskId,
        attachment.id,
      );
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
