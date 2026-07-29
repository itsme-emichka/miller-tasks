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
  COMPLETED_TODAY_RETENTION_MS,
  formatLocalDate,
  isTodayTaskVisible,
} from "./daily";
import {
  CreateTaskInput,
  DailyTaskTemplate,
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
  historyLimit?: number;
}

type HistoryMode = "record" | "preserve" | "reset";

interface HistoryChange {
  label: string;
  taskId: string | null;
  mode?: HistoryMode;
}

interface HistoryEntry {
  before: PluginData;
  after: PluginData;
  label: string;
  taskId: string | null;
}

export interface TaskHistoryResult {
  label: string;
  taskId: string | null;
}

const DEFAULT_HISTORY_LIMIT = 100;

export class TaskStore {
  private data: PluginData;
  private historyBaseline: PluginData;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<StoreListener>();
  private readonly errorListeners =
    new Set<PersistenceErrorListener>();
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly historyLimit: number;

  constructor(
    data: PluginData,
    private readonly persistence?: TaskPersistence,
    options: TaskStoreOptions = {},
  ) {
    this.data = parsePluginData(data);
    this.historyBaseline = clonePluginData(this.data);
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.historyLimit = Math.max(
      0,
      Math.floor(options.historyLimit ?? DEFAULT_HISTORY_LIMIT),
    );
  }

  getSnapshot(): PluginData {
    return clonePluginData(this.data);
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): TaskHistoryResult | null {
    const entry = this.undoStack.pop();
    if (!entry) {
      return null;
    }

    this.redoStack.push(entry);
    this.restoreHistorySnapshot(entry.before);
    return {
      label: entry.label,
      taskId: entry.taskId,
    };
  }

  redo(): TaskHistoryResult | null {
    const entry = this.redoStack.pop();
    if (!entry) {
      return null;
    }

    this.undoStack.push(entry);
    this.restoreHistorySnapshot(entry.after);
    return {
      label: entry.label,
      taskId: entry.taskId,
    };
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
          task.dailyTemplateId === null &&
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

  getTodayTasks(now = this.now()): TaskRecord[] {
    const templateOrder = new Map(
      this.data.dailyTemplates.map((template) => [
        template.id,
        template.order,
      ]),
    );
    return this.data.tasks
      .filter((task) => isTodayTaskVisible(task, now))
      .sort((left, right) => {
        const leftIsDaily = left.dailyTemplateId !== null;
        const rightIsDaily = right.dailyTemplateId !== null;
        if (leftIsDaily !== rightIsDaily) {
          return leftIsDaily ? 1 : -1;
        }
        if (left.completed !== right.completed) {
          return left.completed ? 1 : -1;
        }
        if (leftIsDaily && rightIsDaily) {
          return (
            (templateOrder.get(left.dailyTemplateId!) ?? left.order) -
            (templateOrder.get(right.dailyTemplateId!) ?? right.order)
          );
        }
        return (
          (left.todayAddedAt ?? left.createdAt) -
          (right.todayAddedAt ?? right.createdAt)
        );
      })
      .map(cloneTask);
  }

  getDailyTemplates(): DailyTaskTemplate[] {
    return this.data.dailyTemplates.map((template) => ({
      ...template,
    }));
  }

  getTasksForDailyTemplate(templateId: string): TaskRecord[] {
    return this.data.tasks
      .filter((task) => task.dailyTemplateId === templateId)
      .map(cloneTask);
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
      const parent = this.requireTask(parentId);
      if (parent.dailyTemplateId !== null) {
        throw new TaskDomainError(
          "daily-task-invalid",
          "Daily task instances cannot have subtasks.",
        );
      }
      if (this.getDepth(parentId) >= MAX_TASK_DEPTH) {
        throw new TaskDomainError(
          "depth-exceeded",
          `Tasks can be nested up to ${MAX_TASK_DEPTH} levels.`,
        );
      }
    }

    const id = input.id ?? this.createUniqueId();
    if (
      this.data.tasks.some((task) => task.id === id) ||
      this.data.dailyTemplates.some((template) => template.id === id)
    ) {
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
      today: false,
      todayAddedAt: null,
      dailyTemplateId: null,
      generatedForDate: null,
    };

    this.data.tasks.push(task);
    this.syncAncestorCompletion(parentId, timestamp);
    this.commit({
      label: `Create “${task.title}”`,
      taskId: task.id,
    });
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

    this.commit({
      label: `Edit “${task.title}”`,
      taskId: task.id,
    });
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
    this.syncAncestorCompletion(target.parentId, timestamp);

    this.commit({
      label: `${completed ? "Complete" : "Reopen"} “${target.title}”`,
      taskId: target.id,
    });
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
    this.syncAncestorCompletion(parentId, this.now());
    this.commit({
      label: `Delete “${task.title}”`,
      taskId: task.id,
      mode: removed.some((candidate) => candidate.attachments.length > 0)
        ? "reset"
        : "record",
    });
    return removed;
  }

  moveTask(
    id: string,
    newParentId: string | null,
    newIndex?: number,
  ): TaskRecord {
    const task = this.requireTask(id);
    if (task.dailyTemplateId !== null) {
      throw new TaskDomainError(
        "daily-task-invalid",
        "Daily task instances cannot move into the task tree.",
      );
    }
    if (newParentId !== null) {
      const newParent = this.requireTask(newParentId);
      if (newParent.dailyTemplateId !== null) {
        throw new TaskDomainError(
          "daily-task-invalid",
          "Tasks cannot move below a daily task instance.",
        );
      }
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

    const timestamp = this.now();
    task.updatedAt = timestamp;
    this.syncAncestorCompletion(oldParentId, timestamp);
    if (newParentId !== oldParentId) {
      this.syncAncestorCompletion(newParentId, timestamp);
    }
    this.commit({
      label: `Move “${task.title}”`,
      taskId: task.id,
    });
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
    if (task.dailyTemplateId !== null) {
      throw new TaskDomainError(
        "attachment-invalid",
        "Daily task instances do not support attachments.",
      );
    }
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
    this.commit({
      label: `Add image to “${task.title}”`,
      taskId: task.id,
      mode: "reset",
    });
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
    this.commit({
      label: `Remove image from “${task.title}”`,
      taskId: task.id,
      mode: "reset",
    });
    return { ...removed };
  }

  setShowCompleted(showCompleted: boolean): void {
    if (this.data.showCompleted === showCompleted) {
      return;
    }
    this.data.showCompleted = showCompleted;
    this.commit({
      label: "Toggle completed tasks",
      taskId: null,
      mode: "preserve",
    });
  }

  isTaskScheduledForToday(id: string): boolean {
    const task = this.requireTask(id);
    if (task.dailyTemplateId !== null) {
      return true;
    }
    return this.getLeafTaskIds(id).every(
      (taskId) => this.requireTask(taskId).today,
    );
  }

  setTaskToday(id: string, today: boolean): TaskRecord[] {
    const task = this.requireTask(id);
    if (task.dailyTemplateId !== null) {
      return [cloneTask(task)];
    }
    const leafIds = new Set(this.getLeafTaskIds(id));
    const subtreeIds = this.getSubtreeIds(id);
    const timestamp = this.now();
    let changed = false;

    for (const taskId of subtreeIds) {
      const candidate = this.requireTask(taskId);
      const shouldBeToday = leafIds.has(taskId) ? today : false;
      if (candidate.today === shouldBeToday) {
        continue;
      }
      candidate.today = shouldBeToday;
      candidate.todayAddedAt = shouldBeToday ? timestamp : null;
      candidate.updatedAt = timestamp;
      changed = true;
    }

    if (changed) {
      this.commit({
        label: `${today ? "Add" : "Remove"} “${task.title}” ${
          today ? "to" : "from"
        } Today`,
        taskId: task.id,
      });
    }
    return [...leafIds].map((taskId) =>
      cloneTask(this.requireTask(taskId)),
    );
  }

  createDailyTemplate(title: string): DailyTaskTemplate {
    const timestamp = this.now();
    const template: DailyTaskTemplate = {
      id: this.createUniqueId(),
      title: normalizeTitle(title),
      order: this.data.dailyTemplates.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.data.dailyTemplates.push(template);
    const instance = this.createDailyInstance(
      template,
      formatLocalDate(timestamp),
      timestamp,
    );
    this.commit({
      label: `Create daily task “${template.title}”`,
      taskId: instance.id,
    });
    return { ...template };
  }

  updateDailyTemplate(
    id: string,
    title: string,
  ): DailyTaskTemplate {
    const template = this.requireDailyTemplate(id);
    const normalizedTitle = normalizeTitle(title);
    const timestamp = this.now();
    template.title = normalizedTitle;
    template.updatedAt = timestamp;
    for (const task of this.data.tasks) {
      if (task.dailyTemplateId === id) {
        task.title = normalizedTitle;
        task.updatedAt = timestamp;
      }
    }
    this.commit({
      label: `Rename daily task to “${template.title}”`,
      taskId:
        this.data.tasks.find(
          (task) => task.dailyTemplateId === template.id,
        )?.id ?? null,
    });
    return { ...template };
  }

  deleteDailyTemplate(id: string): TaskRecord[] {
    const template = this.requireDailyTemplate(id);
    const title = template.title;
    const removed = this.getTasksForDailyTemplate(id);
    this.data.dailyTemplates = this.data.dailyTemplates.filter(
      (template) => template.id !== id,
    );
    this.data.dailyTemplates.forEach((template, order) => {
      template.order = order;
    });
    this.data.tasks = this.data.tasks.filter(
      (task) => task.dailyTemplateId !== id,
    );
    this.commit({
      label: `Delete daily task “${title}”`,
      taskId: removed[0]?.id ?? null,
    });
    return removed;
  }

  rollover(now = this.now()): {
    created: TaskRecord[];
    removed: TaskRecord[];
    clearedToday: string[];
  } {
    const today = formatLocalDate(now);
    const removed = this.data.tasks
      .filter(
        (task) =>
          task.dailyTemplateId !== null &&
          task.generatedForDate !== today,
      )
      .map(cloneTask);
    if (removed.length > 0) {
      const removedIds = new Set(removed.map((task) => task.id));
      this.data.tasks = this.data.tasks.filter(
        (task) => !removedIds.has(task.id),
      );
    }

    const clearedToday: string[] = [];
    for (const task of this.data.tasks) {
      if (
        task.dailyTemplateId === null &&
        task.today &&
        task.completed &&
        task.completedAt !== null &&
        task.completedAt + COMPLETED_TODAY_RETENTION_MS <= now
      ) {
        task.today = false;
        task.todayAddedAt = null;
        task.updatedAt = now;
        clearedToday.push(task.id);
      }
    }

    const created: TaskRecord[] = [];
    for (const template of this.data.dailyTemplates) {
      const exists = this.data.tasks.some(
        (task) =>
          task.dailyTemplateId === template.id &&
          task.generatedForDate === today,
      );
      if (!exists) {
        created.push(
          cloneTask(this.createDailyInstance(template, today, now)),
        );
      }
    }

    if (
      removed.length > 0 ||
      clearedToday.length > 0 ||
      created.length > 0
    ) {
      this.commit({
        label: "Run daily rollover",
        taskId: null,
        mode: "reset",
      });
    }
    return { created, removed, clearedToday };
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

  private requireDailyTemplate(id: string): DailyTaskTemplate {
    const template = this.data.dailyTemplates.find(
      (candidate) => candidate.id === id,
    );
    if (!template) {
      throw new TaskDomainError(
        "daily-template-missing",
        `Daily template not found: ${id}`,
      );
    }
    return template;
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

  private getLeafTaskIds(id: string): string[] {
    const task = this.requireTask(id);
    if (task.dailyTemplateId !== null) {
      return [task.id];
    }
    const children = this.orderedMutableChildren(id);
    if (children.length === 0) {
      return [id];
    }
    return children.flatMap((child) =>
      this.getLeafTaskIds(child.id),
    );
  }

  private syncAncestorCompletion(
    parentId: string | null,
    timestamp: number,
  ): void {
    let currentId = parentId;
    while (currentId !== null) {
      const parent = this.requireTask(currentId);
      const children = this.orderedMutableChildren(parent.id);
      if (children.length > 0) {
        const completed = children.every((child) => child.completed);
        if (parent.completed !== completed) {
          parent.completed = completed;
          parent.completedAt = completed ? timestamp : null;
          parent.updatedAt = timestamp;
        }
      }
      currentId = parent.parentId;
    }
  }

  private orderedMutableChildren(
    parentId: string | null,
  ): TaskRecord[] {
    return this.data.tasks
      .filter(
        (task) =>
          task.dailyTemplateId === null && task.parentId === parentId,
      )
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

  private commit(change: HistoryChange): void {
    const after = clonePluginData(this.data);
    const mode = change.mode ?? "record";

    if (mode === "record" && this.historyLimit > 0) {
      this.undoStack.push({
        before: this.historyBaseline,
        after,
        label: change.label,
        taskId: change.taskId,
      });
      if (this.undoStack.length > this.historyLimit) {
        this.undoStack.shift();
      }
      this.redoStack.length = 0;
    } else if (mode === "reset") {
      this.undoStack.length = 0;
      this.redoStack.length = 0;
    }

    this.historyBaseline = after;
    this.notifyAndPersist();
  }

  private restoreHistorySnapshot(snapshot: PluginData): void {
    const showCompleted = this.data.showCompleted;
    this.data = clonePluginData(snapshot);
    this.data.showCompleted = showCompleted;
    this.historyBaseline = clonePluginData(this.data);
    this.notifyAndPersist();
  }

  private notifyAndPersist(): void {
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

  private createDailyInstance(
    template: DailyTaskTemplate,
    date: string,
    timestamp: number,
  ): TaskRecord {
    const task: TaskRecord = {
      id: this.createUniqueId(),
      parentId: null,
      title: template.title,
      completed: false,
      description: "",
      tags: [],
      dueDate: null,
      dueTime: null,
      priority: "none",
      flagged: false,
      url: null,
      attachments: [],
      order: template.order,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      today: true,
      todayAddedAt: timestamp,
      dailyTemplateId: template.id,
      generatedForDate: date,
    };
    this.data.tasks.push(task);
    return task;
  }

  private createUniqueId(): string {
    const id = this.idFactory();
    if (
      this.data.tasks.some((task) => task.id === id) ||
      this.data.dailyTemplates.some((template) => template.id === id)
    ) {
      throw new TaskDomainError(
        "duplicate-id",
        `Generated ID already exists: ${id}`,
      );
    }
    return id;
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
