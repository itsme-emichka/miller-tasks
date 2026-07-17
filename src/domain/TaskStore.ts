import { TaskPersistence } from "../data/TaskPersistence";
import {
  clonePluginData,
  normalizeAttachment,
  normalizeDueDate,
  normalizeDueTime,
  normalizeTags,
  normalizeTitle,
  normalizeUrl,
  parsePluginData,
} from "./pluginData";
import {
  CreateTaskInput,
  MAX_TASK_DEPTH,
  PluginData,
  TaskAttachment,
  TaskDomainError,
  TaskRecord,
  TaskUpdate,
} from "./task";

type StoreListener = () => void;
type PersistenceErrorListener = (error: unknown) => void;

interface TaskStoreOptions {
  idFactory?: () => string;
  now?: () => number;
}

export class TaskStore {
  private data: PluginData;
  private readonly listeners = new Set<StoreListener>();
  private readonly errorListeners =
    new Set<PersistenceErrorListener>();
  private readonly idFactory: () => string;
  private readonly now: () => number;

  constructor(
    data: PluginData,
    private readonly persistence?: TaskPersistence,
    options: TaskStoreOptions = {},
  ) {
    this.data = parsePluginData(data);
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
  }

  getSnapshot(): PluginData {
    return clonePluginData(this.data);
  }

  getTask(id: string): TaskRecord | undefined {
    const task = this.data.tasks.find((candidate) => candidate.id === id);
    return task ? cloneTask(task) : undefined;
  }

  getChildren(
    parentId: string | null,
    includeCompleted = true,
  ): TaskRecord[] {
    return this.data.tasks
      .filter(
        (task) =>
          task.parentId === parentId &&
          (includeCompleted || !task.completed),
      )
      .sort((left, right) => left.order - right.order)
      .map(cloneTask);
  }

  getDepth(id: string): number {
    let task = this.requireTask(id);
    let depth = 1;
    while (task.parentId !== null) {
      task = this.requireTask(task.parentId);
      depth += 1;
    }
    return depth;
  }

  getSubtreeSize(id: string): number {
    return this.getSubtreeIds(id).length;
  }

  getSubtree(id: string): TaskRecord[] {
    return this.getSubtreeIds(id).map((taskId) =>
      cloneTask(this.requireTask(taskId)),
    );
  }

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeToPersistenceErrors(
    listener: PersistenceErrorListener,
  ): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  createTask(input: CreateTaskInput = {}): TaskRecord {
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      this.requireTask(parentId);
      if (this.getDepth(parentId) >= MAX_TASK_DEPTH) {
        throw new TaskDomainError(
          "depth-exceeded",
          `Tasks can be nested up to ${MAX_TASK_DEPTH} levels.`,
        );
      }
    }

    const id = input.id ?? this.idFactory();
    if (this.data.tasks.some((task) => task.id === id)) {
      throw new TaskDomainError(
        "duplicate-id",
        `Task ID already exists: ${id}`,
      );
    }

    const timestamp = this.now();
    const task: TaskRecord = {
      id,
      parentId,
      title: normalizeTitle(input.title ?? "New task"),
      completed: false,
      description: "",
      tags: [],
      dueDate: null,
      dueTime: null,
      priority: "none",
      flagged: false,
      url: null,
      attachments: [],
      order: this.getChildren(parentId).length,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
    };

    this.data.tasks.push(task);
    this.commit();
    return cloneTask(task);
  }

  updateTask(id: string, update: TaskUpdate): TaskRecord {
    const task = this.requireTask(id);
    const dueDate =
      update.dueDate === undefined
        ? task.dueDate
        : normalizeDueDate(update.dueDate);
    const requestedDueTime =
      update.dueTime === undefined
        ? task.dueTime
        : normalizeDueTime(update.dueTime);
    const dueTime = dueDate === null ? null : requestedDueTime;

    if (update.title !== undefined) {
      task.title = normalizeTitle(update.title);
    }
    if (update.description !== undefined) {
      task.description = update.description;
    }
    if (update.tags !== undefined) {
      task.tags = normalizeTags(update.tags);
    }
    if (update.priority !== undefined) {
      task.priority = update.priority;
    }
    if (update.flagged !== undefined) {
      task.flagged = update.flagged;
    }
    if (update.url !== undefined) {
      task.url = normalizeUrl(update.url);
    }
    task.dueDate = dueDate;
    task.dueTime = dueTime;
    task.updatedAt = this.now();

    this.commit();
    return cloneTask(task);
  }

  completeSubtree(id: string, completed: boolean): string[] {
    const target = this.requireTask(id);
    const affectedIds = completed
      ? this.getSubtreeIds(target.id)
      : [target.id];
    const timestamp = this.now();

    for (const affectedId of affectedIds) {
      const task = this.requireTask(affectedId);
      task.completed = completed;
      task.completedAt = completed ? timestamp : null;
      task.updatedAt = timestamp;
    }

    this.commit();
    return affectedIds;
  }

  deleteSubtree(id: string): TaskRecord[] {
    const task = this.requireTask(id);
    const parentId = task.parentId;
    const removedIds = new Set(this.getSubtreeIds(id));
    const removed = this.data.tasks
      .filter((candidate) => removedIds.has(candidate.id))
      .map(cloneTask);

    this.data.tasks = this.data.tasks.filter(
      (candidate) => !removedIds.has(candidate.id),
    );
    this.normalizeSiblings(parentId);
    this.commit();
    return removed;
  }

  moveTask(
    id: string,
    newParentId: string | null,
    newIndex?: number,
  ): TaskRecord {
    const task = this.requireTask(id);
    if (newParentId !== null) {
      this.requireTask(newParentId);
    }

    const subtreeIds = new Set(this.getSubtreeIds(id));
    if (newParentId !== null && subtreeIds.has(newParentId)) {
      throw new TaskDomainError(
        "cycle",
        "A task cannot be moved below its own descendant.",
      );
    }

    const targetDepth =
      newParentId === null ? 0 : this.getDepth(newParentId);
    if (targetDepth + this.getSubtreeHeight(id) > MAX_TASK_DEPTH) {
      throw new TaskDomainError(
        "depth-exceeded",
        `Tasks can be nested up to ${MAX_TASK_DEPTH} levels.`,
      );
    }

    const oldParentId = task.parentId;
    const targetSiblings = this.orderedMutableChildren(
      newParentId,
    ).filter((sibling) => sibling.id !== id);
    const index = clamp(
      newIndex ?? targetSiblings.length,
      0,
      targetSiblings.length,
    );

    task.parentId = newParentId;
    targetSiblings.splice(index, 0, task);
    this.applySiblingOrder(targetSiblings);
    if (oldParentId !== newParentId) {
      this.normalizeSiblings(oldParentId);
    }

    task.updatedAt = this.now();
    this.commit();
    return cloneTask(task);
  }

  reorderTask(id: string, newIndex: number): TaskRecord {
    const task = this.requireTask(id);
    return this.moveTask(id, task.parentId, newIndex);
  }

  addAttachment(
    taskId: string,
    attachment: TaskAttachment,
  ): TaskRecord {
    const task = this.requireTask(taskId);
    const normalized = normalizeAttachment(attachment);
    if (
      task.attachments.some(
        (candidate) => candidate.id === normalized.id,
      )
    ) {
      throw new TaskDomainError(
        "duplicate-id",
        `Attachment ID already exists: ${normalized.id}`,
      );
    }

    task.attachments.push(normalized);
    task.updatedAt = this.now();
    this.commit();
    return cloneTask(task);
  }

  removeAttachment(
    taskId: string,
    attachmentId: string,
  ): TaskAttachment {
    const task = this.requireTask(taskId);
    const index = task.attachments.findIndex(
      (attachment) => attachment.id === attachmentId,
    );
    if (index === -1) {
      throw new TaskDomainError(
        "attachment-invalid",
        `Attachment not found: ${attachmentId}`,
      );
    }

    const [removed] = task.attachments.splice(index, 1);
    if (!removed) {
      throw new TaskDomainError(
        "attachment-invalid",
        `Attachment not found: ${attachmentId}`,
      );
    }
    task.updatedAt = this.now();
    this.commit();
    return { ...removed };
  }

  setShowCompleted(showCompleted: boolean): void {
    if (this.data.showCompleted === showCompleted) {
      return;
    }
    this.data.showCompleted = showCompleted;
    this.commit();
  }

  async flush(): Promise<void> {
    await this.persistence?.flush();
  }

  private requireTask(id: string): TaskRecord {
    const task = this.data.tasks.find((candidate) => candidate.id === id);
    if (!task) {
      throw new TaskDomainError(
        "task-missing",
        `Task not found: ${id}`,
      );
    }
    return task;
  }

  private getSubtreeIds(id: string): string[] {
    this.requireTask(id);
    const result: string[] = [];
    const visit = (taskId: string): void => {
      result.push(taskId);
      for (const child of this.orderedMutableChildren(taskId)) {
        visit(child.id);
      }
    };
    visit(id);
    return result;
  }

  private getSubtreeHeight(id: string): number {
    const children = this.orderedMutableChildren(id);
    if (children.length === 0) {
      return 1;
    }
    return (
      1 +
      Math.max(
        ...children.map((child) => this.getSubtreeHeight(child.id)),
      )
    );
  }

  private orderedMutableChildren(
    parentId: string | null,
  ): TaskRecord[] {
    return this.data.tasks
      .filter((task) => task.parentId === parentId)
      .sort((left, right) => left.order - right.order);
  }

  private normalizeSiblings(parentId: string | null): void {
    this.applySiblingOrder(this.orderedMutableChildren(parentId));
  }

  private applySiblingOrder(tasks: readonly TaskRecord[]): void {
    const timestamp = this.now();
    tasks.forEach((task, order) => {
      if (task.order !== order) {
        task.order = order;
        task.updatedAt = timestamp;
      }
    });
  }

  private commit(): void {
    for (const listener of this.listeners) {
      listener();
    }

    if (!this.persistence) {
      return;
    }
    void this.persistence
      .save(this.data)
      .catch((error: unknown) => {
        for (const listener of this.errorListeners) {
          listener(error);
        }
      });
  }
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    tags: [...task.tags],
    attachments: task.attachments.map((attachment) => ({
      ...attachment,
    })),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
