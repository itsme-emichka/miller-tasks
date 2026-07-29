import { Notice, Plugin, WorkspaceLeaf } from "obsidian";

import {
  MILLER_TASK_INSPECTOR_VIEW_TYPE,
  MILLER_TASK_TREE_VIEW_TYPE,
  MILLER_TASKS_VIEW_TYPE,
} from "./constants";
import { TaskAttachmentService } from "./data/TaskAttachmentService";
import {
  getOrCreateReplicaId,
  isReplicaPath,
  ReplicaPersistence,
} from "./data/ReplicaPersistence";
import { VaultReplicaFileStore } from "./data/VaultReplicaFileStore";
import { TaskStore } from "./domain/TaskStore";
import { TaskDraftBuffer } from "./state/TaskDraftBuffer";
import { TaskSelection } from "./state/TaskSelection";
import {
  runTaskRollover,
  TASK_ROLLOVER_INTERVAL_MS,
} from "./state/runTaskRollover";
import { TaskAttachment } from "./domain/task";
import {
  isTaskHistoryContext,
  isTextEditingTarget,
  resolveTaskHistoryShortcut,
} from "./ui/taskHistoryShortcuts";
import type { TaskAttachmentActions } from "./ui/attachmentActions";
import type { DailyTemplateActions } from "./ui/dailyTemplateActions";
import type {
  TaskInspectorPresentation,
} from "./ui/MillerTasksApp";
import type { TaskActions } from "./ui/taskActions";
import { requestConfirmation } from "./view/ConfirmationModal";
import { MillerTaskInspectorModal } from "./view/MillerTaskInspectorModal";
import { MillerTaskInspectorView } from "./view/MillerTaskInspectorView";
import { MillerTaskTreeView } from "./view/MillerTaskTreeView";
import { MillerTasksView } from "./view/MillerTasksView";

interface InspectorActions {
  attachments: TaskAttachmentActions;
  dailyTemplates: DailyTemplateActions;
  tasks: TaskActions;
}

export default class MillerTasksPlugin extends Plugin {
  private taskStore: TaskStore | null = null;
  private taskDrafts: TaskDraftBuffer | null = null;
  private attachmentService: TaskAttachmentService | null = null;
  private inspectorModal: MillerTaskInspectorModal | null = null;
  private inspectorActions: InspectorActions | null = null;
  private replicaPersistence: ReplicaPersistence | null = null;
  private replicaReconcileTimer: number | null = null;
  private replicaReconcileQueue: Promise<void> = Promise.resolve();
  private invalidReplicaFingerprint = "";
  private compactLayout = false;
  private readonly taskSelection = new TaskSelection();

  override async onload(): Promise<void> {
    try {
      const replicaId = getOrCreateReplicaId(
        window.localStorage,
        this.app.vault.getName(),
      );
      const persistence = new ReplicaPersistence(
        replicaId,
        new VaultReplicaFileStore(this.app.vault),
        () => this.loadData(),
      );
      this.replicaPersistence = persistence;
      const loaded = await persistence.load();
      this.taskStore = new TaskStore(
        loaded.state,
        persistence,
        { actorId: replicaId },
      );
      this.reportInvalidReplicas(loaded.invalidPaths, false);
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
    const inspectorActions: InspectorActions = {
      attachments: {
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
      dailyTemplates: {
        deleteTemplate: (templateId, title) =>
          this.deleteDailyTemplate(templateId, title),
      },
      tasks: {
        deleteTask: async (taskId) => {
          await this.deleteTask(taskId);
          if (!taskStore.getTask(taskId)) {
            this.inspectorModal?.close();
          }
        },
      },
    };
    this.inspectorActions = inspectorActions;
    this.register(
      taskStore.subscribeToPersistenceErrors(() => {
        new Notice("Miller tasks could not save the latest changes.");
      }),
    );
    const runRollover = (): void => {
      runTaskRollover(taskStore, this.taskSelection);
    };
    runRollover();
    this.registerInterval(
      window.setInterval(
        runRollover,
        TASK_ROLLOVER_INTERVAL_MS,
      ),
    );
    this.registerReplicaEvents();

    this.registerView(
      MILLER_TASKS_VIEW_TYPE,
      (leaf) =>
        new MillerTasksView(
          leaf,
          taskStore,
          (taskId) => {
            this.updateTaskSelection(taskId);
          },
          {
            toggleView: () => {
              void this.switchLeafView(
                leaf,
                MILLER_TASK_TREE_VIEW_TYPE,
              );
            },
            openInspector: (taskId, presentation) => {
              this.openTaskInspector(taskId, presentation);
            },
            setCompactLayout: (compact) => {
              this.setCompactLayout(compact);
            },
            completeTask: (taskId, completed) => {
              void this.completeTask(taskId, completed);
            },
            deleteTask: (taskId) => {
              void this.deleteTask(taskId);
            },
            reportMoveError: (message) => {
              new Notice(message);
            },
            dailyTemplateActions: inspectorActions.dailyTemplates,
          },
        ),
    );
    this.registerView(
      MILLER_TASK_TREE_VIEW_TYPE,
      (leaf) =>
        new MillerTaskTreeView(
          leaf,
          taskStore,
          this.taskSelection,
          (taskId) => {
            this.selectTask(taskId);
          },
          {
            toggleView: () => {
              void this.switchLeafView(
                leaf,
                MILLER_TASKS_VIEW_TYPE,
              );
            },
            completeTask: (taskId, completed) => {
              void this.completeTask(taskId, completed);
            },
            deleteTask: (taskId) => {
              void this.deleteTask(taskId);
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
          inspectorActions.attachments,
          inspectorActions.dailyTemplates,
          inspectorActions.tasks,
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
      id: "open-task-tree",
      name: "Open task tree",
      callback: () => {
        void this.activateTreeView();
      },
    });

    this.addCommand({
      id: "open-task-details",
      name: "Open task details",
      callback: () => {
        const taskId = this.taskSelection.getSelectedTaskId();
        if (this.compactLayout && taskId !== null) {
          this.openTaskInspectorPopup(taskId);
        } else {
          void this.activateInspector();
        }
      },
    });

    this.addCommand({
      id: "rescan-synchronized-task-files",
      name: "Rescan synchronized task files",
      callback: () => {
        this.scheduleReplicaReconcile();
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

    this.addCommand({
      id: "undo-task-change",
      name: "Undo last task change",
      checkCallback: (checking) => {
        if (!taskStore.canUndo()) {
          return false;
        }
        if (!checking) {
          this.undoTaskChange();
        }
        return true;
      },
    });

    this.addCommand({
      id: "redo-task-change",
      name: "Redo last task change",
      checkCallback: (checking) => {
        if (!taskStore.canRedo()) {
          return false;
        }
        if (!checking) {
          this.redoTaskChange();
        }
        return true;
      },
    });

    this.registerDomEvent(document, "keydown", (event) => {
      if (
        !isTaskHistoryContext(
          event.target,
          this.hasActiveTaskView(),
        ) ||
        isTextEditingTarget(event.target)
      ) {
        return;
      }

      const shortcut = resolveTaskHistoryShortcut(event);
      if (shortcut === null) {
        return;
      }
      const handled =
        shortcut === "undo"
          ? this.undoTaskChange()
          : this.redoTaskChange();
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    }, { capture: true });
  }

  private registerReplicaEvents(): void {
    const schedulePath = (path: string): void => {
      if (isReplicaPath(path)) {
        this.scheduleReplicaReconcile();
      }
    };
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        schedulePath(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        schedulePath(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        schedulePath(file.path);
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (isReplicaPath(file.path) || isReplicaPath(oldPath)) {
          this.scheduleReplicaReconcile();
        }
      }),
    );
  }

  private scheduleReplicaReconcile(): void {
    if (this.replicaReconcileTimer !== null) {
      window.clearTimeout(this.replicaReconcileTimer);
    }
    this.replicaReconcileTimer = window.setTimeout(() => {
      this.replicaReconcileTimer = null;
      const reconcile = this.replicaReconcileQueue.then(() =>
        this.reconcileReplicaFiles(),
      );
      this.replicaReconcileQueue = reconcile.catch(() => {
        new Notice(
          "Miller tasks could not reconcile synchronized files. It will retry after the next file change.",
        );
      });
    }, 800);
  }

  private async reconcileReplicaFiles(): Promise<void> {
    const persistence = this.replicaPersistence;
    const taskStore = this.taskStore;
    if (!persistence || !taskStore) {
      return;
    }

    this.taskDrafts?.flushAll();
    await taskStore.flush().catch(() => undefined);
    const scan = await persistence.scan();
    const result = persistence.reconcile(
      taskStore.getSyncSnapshot(),
      scan,
    );
    this.reportInvalidReplicas(
      result.invalidPaths,
      result.blocked,
    );
    if (result.blocked) {
      return;
    }

    if (result.materialChange) {
      if (taskStore.replaceFromSync(result.state)) {
        const selectedTaskId =
          this.taskSelection.getSelectedTaskId();
        if (
          selectedTaskId !== null &&
          !taskStore.getTask(selectedTaskId)
        ) {
          this.taskSelection.setSelectedTaskId(null);
          this.inspectorModal?.close();
        }
        await taskStore.flush();
        new Notice("Miller tasks merged changes from another device.");
      }
      return;
    }

    if (result.localWriteRequired) {
      await persistence.save(taskStore.getSyncSnapshot());
    }
  }

  private reportInvalidReplicas(
    paths: readonly string[],
    blocked: boolean,
  ): void {
    const fingerprint = `${blocked ? "blocked" : "ignored"}:${[
      ...paths,
    ].sort().join("|")}`;
    if (fingerprint === this.invalidReplicaFingerprint) {
      return;
    }
    this.invalidReplicaFingerprint = fingerprint;
    if (paths.length === 0) {
      return;
    }
    if (blocked) {
      new Notice(
        "The local miller tasks sync file is invalid. Saving is paused to protect your tasks.",
      );
      return;
    }
    new Notice(
      `${paths.length} Miller Tasks sync file${
        paths.length === 1 ? " was" : "s were"
      } ignored because ${
        paths.length === 1 ? "it is" : "they are"
      } incomplete or invalid.`,
    );
  }

  override onunload(): void {
    if (this.replicaReconcileTimer !== null) {
      window.clearTimeout(this.replicaReconcileTimer);
      this.replicaReconcileTimer = null;
    }
    this.inspectorModal?.close();
    this.inspectorModal = null;
    this.taskDrafts?.flushAll();
    void this.taskStore?.flush().catch(() => undefined);
  }

  private updateTaskSelection(taskId: string | null): void {
    this.taskDrafts?.flushAll();
    this.taskSelection.setSelectedTaskId(taskId);
  }

  private selectTask(taskId: string | null): void {
    this.updateTaskSelection(taskId);
    if (taskId !== null && !this.compactLayout) {
      void this.activateInspector();
    }
  }

  private openTaskInspector(
    taskId: string,
    presentation: TaskInspectorPresentation,
  ): void {
    if (presentation === "popup") {
      this.openTaskInspectorPopup(taskId);
      return;
    }
    this.selectTask(taskId);
  }

  private openTaskInspectorPopup(taskId: string): void {
    const taskStore = this.taskStore;
    const taskDrafts = this.taskDrafts;
    const actions = this.inspectorActions;
    if (!taskStore?.getTask(taskId) || !taskDrafts || !actions) {
      return;
    }

    this.updateTaskSelection(taskId);
    this.inspectorModal?.close();
    const modal = new MillerTaskInspectorModal(
      this.app,
      taskStore,
      this.taskSelection,
      taskDrafts,
      actions.attachments,
      actions.dailyTemplates,
      actions.tasks,
      () => {
        if (this.inspectorModal === modal) {
          this.inspectorModal = null;
        }
      },
    );
    this.inspectorModal = modal;
    modal.open();
  }

  private setCompactLayout(compact: boolean): void {
    this.compactLayout = compact;
    if (compact) {
      for (const leaf of this.app.workspace.getLeavesOfType(
        MILLER_TASK_INSPECTOR_VIEW_TYPE,
      )) {
        leaf.detach();
      }
      return;
    }
    this.inspectorModal?.close();
  }

  private undoTaskChange(): boolean {
    this.taskDrafts?.flushAll();
    const result = this.taskStore?.undo();
    if (!result) {
      return false;
    }

    this.reconcileSelectionAfterHistory(result.taskId);
    new Notice(`Undo: ${result.label}`);
    return true;
  }

  private redoTaskChange(): boolean {
    this.taskDrafts?.flushAll();
    const result = this.taskStore?.redo();
    if (!result) {
      return false;
    }

    this.reconcileSelectionAfterHistory(result.taskId);
    new Notice(`Redo: ${result.label}`);
    return true;
  }

  private reconcileSelectionAfterHistory(
    historyTaskId: string | null,
  ): void {
    const taskStore = this.taskStore;
    if (!taskStore) {
      return;
    }

    const selectedTaskId = this.taskSelection.getSelectedTaskId();
    if (
      selectedTaskId !== null &&
      !taskStore.getTask(selectedTaskId)
    ) {
      this.taskSelection.setSelectedTaskId(null);
      return;
    }
    if (
      selectedTaskId === null &&
      historyTaskId !== null &&
      taskStore.getTask(historyTaskId)
    ) {
      this.taskSelection.setSelectedTaskId(historyTaskId);
      if (!this.compactLayout) {
        void this.activateInspector();
      }
    }
  }

  private hasActiveTaskView(): boolean {
    const { workspace } = this.app;
    return (
      workspace.getActiveViewOfType(MillerTasksView) !== null ||
      workspace.getActiveViewOfType(MillerTaskTreeView) !== null ||
      workspace.getActiveViewOfType(MillerTaskInspectorView) !== null
    );
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
    const taskId = this.taskSelection.getSelectedTaskId();
    if (taskId === null) {
      new Notice("Select a task to delete.");
      return;
    }
    await this.deleteTask(taskId);
  }

  private async deleteTask(taskId: string): Promise<void> {
    const taskStore = this.taskStore;
    const task = taskStore?.getTask(taskId);
    if (!taskStore || !task) {
      return;
    }
    if (task.dailyTemplateId !== null) {
      await this.deleteDailyTemplate(
        task.dailyTemplateId,
        task.title,
        false,
      );
      return;
    }

    const subtreeSize = taskStore.getSubtreeSize(task.id);
    if (subtreeSize > 1) {
      const confirmed = await requestConfirmation(this.app, {
        title: "Delete task and subtasks?",
        message:
          `"${task.title}" and ${subtreeSize - 1} subtasks ` +
          "will be deleted.",
        confirmLabel: "Delete all",
      });
      if (!confirmed) {
        return;
      }
    }

    this.taskDrafts?.flushAll();
    const subtree = taskStore.getSubtree(task.id);
    try {
      await this.attachmentService?.trashTaskAttachments(
        subtree,
      );
    } catch {
      new Notice(
        "The task was not deleted because its images could not be moved to trash.",
      );
      return;
    }
    taskStore.deleteSubtree(task.id);
    const selectedTaskId = this.taskSelection.getSelectedTaskId();
    if (
      selectedTaskId !== null &&
      subtree.some((candidate) => candidate.id === selectedTaskId)
    ) {
      this.taskSelection.setSelectedTaskId(null);
    }
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

  private async deleteDailyTemplate(
    templateId: string,
    title: string,
    requiresConfirmation = true,
  ): Promise<void> {
    const taskStore = this.taskStore;
    if (!taskStore) {
      return;
    }

    if (requiresConfirmation) {
      const confirmed = await requestConfirmation(this.app, {
        title: "Delete daily task?",
        message:
          `"${title}" will stop appearing each day. ` +
          "Today's instance will also be deleted.",
        confirmLabel: "Delete",
      });
      if (!confirmed) {
        return;
      }
    }

    this.taskDrafts?.flushAll();
    const selectedTaskId = this.taskSelection.getSelectedTaskId();
    const selectedTask = selectedTaskId
      ? taskStore.getTask(selectedTaskId)
      : undefined;
    taskStore.deleteDailyTemplate(templateId);
    if (selectedTask?.dailyTemplateId === templateId) {
      this.taskSelection.setSelectedTaskId(null);
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

  private async switchLeafView(
    leaf: WorkspaceLeaf,
    viewType: string,
  ): Promise<void> {
    await leaf.setViewState({
      type: viewType,
      active: true,
    });
    await this.app.workspace.revealLeaf(leaf);
  }

  private async activateTreeView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | undefined =
      workspace.getLeavesOfType(MILLER_TASK_TREE_VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getLeaf(true);
      await leaf.setViewState({
        type: MILLER_TASK_TREE_VIEW_TYPE,
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
