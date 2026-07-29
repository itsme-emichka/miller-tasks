import { TaskPersistence } from "../data/TaskPersistence";
import {
  materializePluginDataV3,
} from "../sync/materializeSyncData";
import {
  isAttachmentPresent,
  isEntityPresent,
} from "../sync/mergeSyncData";
import {
  comparePositionKeys,
  generatePositionKeyBetween,
} from "../sync/positionKey";
import { parseOrMigratePluginDataV3 } from "../sync/parseSyncData";
import {
  clonePluginDataV3,
  cloneVersion,
  createDailyOccurrenceId,
  DailyOccurrenceFieldGroup,
  PluginDataV3,
  SyncedDailyOccurrence,
  SyncedDailyTemplate,
  SyncedTask,
  TaskFieldGroup,
  VersionStamp,
} from "../sync/syncData";
import {
  normalizeAttachment,
  normalizeDueDate,
  normalizeDueTime,
  normalizeTags,
  normalizeTitle,
  normalizeUrl,
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
  actorId?: string;
}

type HistoryMode = "record" | "preserve" | "reset";

interface HistoryChange {
  label: string;
  taskId: string | null;
  mode?: HistoryMode;
}

interface HistoryEntry {
  before: PluginDataV3;
  after: PluginDataV3;
  label: string;
  taskId: string | null;
}

export interface TaskHistoryResult {
  label: string;
  taskId: string | null;
}

const DEFAULT_HISTORY_LIMIT = 100;

export class TaskStore {
  private data: PluginDataV3;
  private historyBaseline: PluginDataV3;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<StoreListener>();
  private readonly errorListeners =
    new Set<PersistenceErrorListener>();
  private readonly idFactory: () => string;
  private readonly now: () => number;
  private readonly historyLimit: number;
  private readonly actorId: string;

  constructor(
    data: unknown,
    private readonly persistence?: TaskPersistence,
    options: TaskStoreOptions = {},
  ) {
    this.data = parseOrMigratePluginDataV3(data);
    this.historyBaseline = clonePluginDataV3(this.data);
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
    this.historyLimit = Math.max(
      0,
      Math.floor(options.historyLimit ?? DEFAULT_HISTORY_LIMIT),
    );
    this.actorId = options.actorId ?? crypto.randomUUID();
  }

  getSnapshot(): PluginData {
    return materializePluginDataV3(this.data);
  }

  getSyncSnapshot(): PluginDataV3 {
    return clonePluginDataV3(this.data);
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
    this.applyHistoryTarget(entry.before);
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
    this.applyHistoryTarget(entry.after);
    return {
      label: entry.label,
      taskId: entry.taskId,
    };
  }

  getTask(id: string): TaskRecord | undefined {
    return this.getSnapshot().tasks.find((task) => task.id === id);
  }

  getChildren(
    parentId: string | null,
    includeCompleted = true,
  ): TaskRecord[] {
    return this.getSnapshot().tasks
      .filter(
        (task) =>
          task.dailyTemplateId === null &&
          task.parentId === parentId &&
          (includeCompleted || !task.completed),
      )
      .sort((left, right) => left.order - right.order);
  }

  getDepth(id: string): number {
    const occurrence = this.findOccurrence(id);
    if (occurrence) {
      return 1;
    }
    let task = this.requireTreeTask(id);
    let depth = 1;
    while (task.parentId !== null) {
      task = this.requireTreeTask(task.parentId);
      depth += 1;
    }
    return depth;
  }

  getSubtreeSize(id: string): number {
    return this.getSubtreeIds(id).length;
  }

  getSubtree(id: string): TaskRecord[] {
    return this.getSubtreeIds(id).map((taskId) =>
      this.requireTaskView(taskId),
    );
  }

  getTodayTasks(now = this.now()): TaskRecord[] {
    const snapshot = this.getSnapshot();
    const templateOrder = new Map(
      snapshot.dailyTemplates.map((template) => [
        template.id,
        template.order,
      ]),
    );
    return snapshot.tasks
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
      });
  }

  getDailyTemplates(): DailyTaskTemplate[] {
    return this.getSnapshot().dailyTemplates;
  }

  getTasksForDailyTemplate(templateId: string): TaskRecord[] {
    return this.getSnapshot().tasks.filter(
      (task) => task.dailyTemplateId === templateId,
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
      this.requireTreeTask(parentId);
      if (this.getDepth(parentId) >= MAX_TASK_DEPTH) {
        throw new TaskDomainError(
          "depth-exceeded",
          `Tasks can be nested up to ${MAX_TASK_DEPTH} levels.`,
        );
      }
    }

    const id = input.id ?? this.createUniqueId();
    this.requireUniqueId(id);
    const timestamp = this.now();
    const version = this.nextVersion();
    const siblings = this.orderedMutableChildren(parentId);
    const task: SyncedTask = {
      id,
      parentId,
      positionKey: generatePositionKeyBetween(
        siblings.at(-1)?.positionKey ?? null,
        null,
      ),
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
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      today: false,
      todayAddedAt: null,
      existence: cloneVersion(version),
      fieldVersions: createTaskFieldVersions(version),
    };

    this.data.tasks.push(task);
    this.syncAncestorCompletion(parentId, timestamp, version);
    this.commit({
      label: `Create “${task.title}”`,
      taskId: task.id,
    });
    return this.requireTaskView(task.id);
  }

  updateTask(id: string, update: TaskUpdate): TaskRecord {
    const treeTask = this.findTreeTask(id);
    const occurrence = this.findOccurrence(id);
    if (!treeTask && !occurrence) {
      this.missingTask(id);
    }

    const timestamp = this.now();
    const occurrenceTitle =
      occurrence && update.title !== undefined
        ? normalizeTitle(update.title)
        : undefined;
    const occurrenceTemplate = occurrence
      ? this.requireDailyTemplateRecord(occurrence.templateId)
      : undefined;
    const changedTreeGroups = treeTask
      ? this.applyTreeTaskUpdate(treeTask, update)
      : [];
    const changedOccurrenceGroups = occurrence
      ? this.applyOccurrenceUpdate(occurrence, update)
      : [];
    let templateTitleChanged = false;

    if (occurrenceTemplate && occurrenceTitle !== undefined) {
      templateTitleChanged =
        occurrenceTemplate.title !== occurrenceTitle;
      occurrenceTemplate.title = occurrenceTitle;
    }

    if (
      changedTreeGroups.length === 0 &&
      changedOccurrenceGroups.length === 0 &&
      !templateTitleChanged
    ) {
      return this.requireTaskView(id);
    }

    const version = this.nextVersion();
    if (treeTask) {
      treeTask.updatedAt = timestamp;
      for (const group of changedTreeGroups) {
        treeTask.fieldVersions[group] = cloneVersion(version);
      }
    }
    if (occurrence) {
      occurrence.updatedAt = timestamp;
      for (const group of changedOccurrenceGroups) {
        occurrence.fieldVersions[group] = cloneVersion(version);
      }
    }
    if (occurrenceTemplate && templateTitleChanged) {
      occurrenceTemplate.updatedAt = timestamp;
      occurrenceTemplate.fieldVersions.title = cloneVersion(version);
    }

    this.commit({
      label: `Edit “${this.requireTaskView(id).title}”`,
      taskId: id,
    });
    return this.requireTaskView(id);
  }

  completeSubtree(id: string, completed: boolean): string[] {
    const occurrence = this.findOccurrence(id);
    const timestamp = this.now();
    const version = this.nextVersion();
    if (occurrence) {
      occurrence.completed = completed;
      occurrence.completedAt = completed ? timestamp : null;
      occurrence.updatedAt = timestamp;
      occurrence.fieldVersions.completion = cloneVersion(version);
      this.commit({
        label: `${completed ? "Complete" : "Reopen"} “${
          this.requireTaskView(id).title
        }”`,
        taskId: id,
      });
      return [id];
    }

    const target = this.requireTreeTask(id);
    const affectedIds = completed
      ? this.getSubtreeIds(target.id)
      : [target.id];
    for (const affectedId of affectedIds) {
      const task = this.requireTreeTask(affectedId);
      task.completed = completed;
      task.completedAt = completed ? timestamp : null;
      task.updatedAt = timestamp;
      task.fieldVersions.completion = cloneVersion(version);
    }
    this.syncAncestorCompletion(target.parentId, timestamp, version);

    this.commit({
      label: `${completed ? "Complete" : "Reopen"} “${target.title}”`,
      taskId: target.id,
    });
    return affectedIds;
  }

  deleteSubtree(id: string): TaskRecord[] {
    const occurrence = this.findOccurrence(id);
    if (occurrence) {
      const removed = [this.requireTaskView(id)];
      const version = this.nextVersion();
      this.tombstoneEntity(
        "daily-occurrence",
        id,
        version,
        this.now(),
      );
      this.commit({
        label: `Delete “${removed[0]!.title}”`,
        taskId: id,
      });
      return removed;
    }

    const task = this.requireTreeTask(id);
    const parentId = task.parentId;
    const removedIds = this.getSubtreeIds(id);
    const removed = removedIds.map((taskId) =>
      this.requireTaskView(taskId),
    );
    const timestamp = this.now();
    const version = this.nextVersion();
    for (const removedId of removedIds) {
      this.tombstoneEntity("task", removedId, version, timestamp);
    }
    this.syncAncestorCompletion(parentId, timestamp, version);
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
    if (this.findOccurrence(id)) {
      throw new TaskDomainError(
        "daily-task-invalid",
        "Daily task instances cannot move into the task tree.",
      );
    }
    const task = this.requireTreeTask(id);
    if (newParentId !== null) {
      this.requireTreeTask(newParentId);
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
    const left = targetSiblings[index - 1]?.positionKey ?? null;
    const right = targetSiblings[index]?.positionKey ?? null;
    const timestamp = this.now();
    const version = this.nextVersion();

    task.parentId = newParentId;
    task.positionKey = generatePositionKeyBetween(left, right);
    task.updatedAt = timestamp;
    task.fieldVersions.structure = cloneVersion(version);
    this.syncAncestorCompletion(oldParentId, timestamp, version);
    if (newParentId !== oldParentId) {
      this.syncAncestorCompletion(newParentId, timestamp, version);
    }
    this.commit({
      label: `Move “${task.title}”`,
      taskId: task.id,
    });
    return this.requireTaskView(id);
  }

  reorderTask(id: string, newIndex: number): TaskRecord {
    const task = this.requireTreeTask(id);
    return this.moveTask(id, task.parentId, newIndex);
  }

  addAttachment(
    taskId: string,
    attachment: TaskAttachment,
  ): TaskRecord {
    const task = this.requireTreeTask(taskId);
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

    const version = this.nextVersion();
    task.attachments.push({
      ...normalized,
      added: cloneVersion(version),
    });
    task.updatedAt = this.now();
    this.commit({
      label: `Add image to “${task.title}”`,
      taskId: task.id,
      mode: "reset",
    });
    return this.requireTaskView(taskId);
  }

  removeAttachment(
    taskId: string,
    attachmentId: string,
  ): TaskAttachment {
    const task = this.requireTreeTask(taskId);
    const attachment = task.attachments.find(
      (candidate) =>
        candidate.id === attachmentId &&
        isAttachmentPresent(this.data, taskId, attachmentId),
    );
    if (!attachment) {
      throw new TaskDomainError(
        "attachment-invalid",
        `Attachment not found: ${attachmentId}`,
      );
    }

    const version = this.nextVersion();
    this.data.attachmentTombstones.push({
      taskId,
      attachmentId,
      removed: cloneVersion(version),
      removedAt: this.now(),
    });
    task.updatedAt = this.now();
    this.commit({
      label: `Remove image from “${task.title}”`,
      taskId: task.id,
      mode: "reset",
    });
    const { added: _added, ...removed } = attachment;
    return removed;
  }

  setShowCompleted(showCompleted: boolean): void {
    if (this.data.showCompleted === showCompleted) {
      return;
    }
    this.data.showCompleted = showCompleted;
    this.data.showCompletedVersion = this.nextVersion();
    this.commit({
      label: "Toggle completed tasks",
      taskId: null,
      mode: "preserve",
    });
  }

  isTaskScheduledForToday(id: string): boolean {
    if (this.findOccurrence(id)) {
      return true;
    }
    this.requireTreeTask(id);
    return this.getLeafTaskIds(id).every(
      (taskId) => this.requireTreeTask(taskId).today,
    );
  }

  setTaskToday(id: string, today: boolean): TaskRecord[] {
    if (this.findOccurrence(id)) {
      return [this.requireTaskView(id)];
    }
    const task = this.requireTreeTask(id);
    const leafIds = new Set(this.getLeafTaskIds(id));
    const subtreeIds = this.getSubtreeIds(id);
    const changedIds = subtreeIds.filter((taskId) => {
      const candidate = this.requireTreeTask(taskId);
      return candidate.today !== (leafIds.has(taskId) ? today : false);
    });

    if (changedIds.length > 0) {
      const timestamp = this.now();
      const version = this.nextVersion();
      for (const taskId of changedIds) {
        const candidate = this.requireTreeTask(taskId);
        const shouldBeToday = leafIds.has(taskId) ? today : false;
        candidate.today = shouldBeToday;
        candidate.todayAddedAt = shouldBeToday ? timestamp : null;
        candidate.updatedAt = timestamp;
        candidate.fieldVersions.today = cloneVersion(version);
      }
      this.commit({
        label: `${today ? "Add" : "Remove"} “${task.title}” ${
          today ? "to" : "from"
        } Today`,
        taskId: task.id,
      });
    }
    return [...leafIds].map((taskId) =>
      this.requireTaskView(taskId),
    );
  }

  createDailyTemplate(title: string): DailyTaskTemplate {
    const timestamp = this.now();
    const version = this.nextVersion();
    const id = this.createUniqueId();
    this.requireUniqueId(id);
    const templates = this.orderedMutableTemplates();
    const template: SyncedDailyTemplate = {
      id,
      title: normalizeTitle(title),
      positionKey: generatePositionKeyBetween(
        templates.at(-1)?.positionKey ?? null,
        null,
      ),
      createdAt: timestamp,
      updatedAt: timestamp,
      existence: cloneVersion(version),
      fieldVersions: {
        title: cloneVersion(version),
        position: cloneVersion(version),
      },
    };
    this.data.dailyTemplates.push(template);
    const occurrence = this.createDailyOccurrence(
      template,
      formatLocalDate(timestamp),
      timestamp,
      version,
    );
    this.commit({
      label: `Create daily task “${template.title}”`,
      taskId: occurrence.id,
    });
    return this.requireDailyTemplateView(template.id);
  }

  updateDailyTemplate(
    id: string,
    title: string,
  ): DailyTaskTemplate {
    const template = this.requireDailyTemplateRecord(id);
    const normalizedTitle = normalizeTitle(title);
    if (template.title === normalizedTitle) {
      return this.requireDailyTemplateView(id);
    }
    const timestamp = this.now();
    const version = this.nextVersion();
    template.title = normalizedTitle;
    template.updatedAt = timestamp;
    template.fieldVersions.title = cloneVersion(version);
    this.commit({
      label: `Rename daily task to “${template.title}”`,
      taskId:
        this.activeOccurrences().find(
          (occurrence) => occurrence.templateId === template.id,
        )?.id ?? null,
    });
    return this.requireDailyTemplateView(id);
  }

  deleteDailyTemplate(id: string): TaskRecord[] {
    const template = this.requireDailyTemplateRecord(id);
    const removed = this.getTasksForDailyTemplate(id);
    const timestamp = this.now();
    const version = this.nextVersion();
    this.tombstoneEntity(
      "daily-template",
      id,
      version,
      timestamp,
    );
    for (const occurrence of this.activeOccurrences().filter(
      (candidate) => candidate.templateId === id,
    )) {
      this.tombstoneEntity(
        "daily-occurrence",
        occurrence.id,
        version,
        timestamp,
      );
    }
    this.commit({
      label: `Delete daily task “${template.title}”`,
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
    const expiredOccurrences = this.activeOccurrences().filter(
      (occurrence) => occurrence.date !== today,
    );
    const removed = expiredOccurrences.map((occurrence) =>
      this.requireTaskView(occurrence.id),
    );
    const tasksToClear = this.activeTreeTasks().filter(
      (task) =>
        task.today &&
        task.completed &&
        task.completedAt !== null &&
        task.completedAt + COMPLETED_TODAY_RETENTION_MS <= now,
    );
    const templatesMissingOccurrence =
      this.orderedMutableTemplates().filter(
        (template) =>
          !this.activeOccurrences().some(
            (occurrence) =>
              occurrence.templateId === template.id &&
              occurrence.date === today,
          ),
      );

    if (
      expiredOccurrences.length === 0 &&
      tasksToClear.length === 0 &&
      templatesMissingOccurrence.length === 0
    ) {
      return { created: [], removed: [], clearedToday: [] };
    }

    const version = this.nextVersion();
    for (const occurrence of expiredOccurrences) {
      this.tombstoneEntity(
        "daily-occurrence",
        occurrence.id,
        version,
        now,
      );
    }
    const clearedToday: string[] = [];
    for (const task of tasksToClear) {
      task.today = false;
      task.todayAddedAt = null;
      task.updatedAt = now;
      task.fieldVersions.today = cloneVersion(version);
      clearedToday.push(task.id);
    }
    const createdIds: string[] = [];
    for (const template of templatesMissingOccurrence) {
      const occurrence = this.createDailyOccurrence(
        template,
        today,
        now,
        version,
      );
      createdIds.push(occurrence.id);
    }

    this.commit({
      label: "Run daily rollover",
      taskId: null,
      mode: "reset",
    });
    return {
      created: createdIds.map((id) => this.requireTaskView(id)),
      removed,
      clearedToday,
    };
  }

  async flush(): Promise<void> {
    await this.persistence?.flush();
  }

  private applyTreeTaskUpdate(
    task: SyncedTask,
    update: TaskUpdate,
  ): TaskFieldGroup[] {
    const changed = new Set<TaskFieldGroup>();
    const title =
      update.title === undefined
        ? task.title
        : normalizeTitle(update.title);
    const tags =
      update.tags === undefined ? task.tags : normalizeTags(update.tags);
    const due = normalizedDueUpdate(task, update);
    const url =
      update.url === undefined ? task.url : normalizeUrl(update.url);

    if (update.title !== undefined) {
      if (task.title !== title) {
        task.title = title;
        changed.add("title");
      }
    }
    if (
      update.description !== undefined &&
      task.description !== update.description
    ) {
      task.description = update.description;
      changed.add("description");
    }
    if (update.tags !== undefined) {
      if (!sameStrings(task.tags, tags)) {
        task.tags = tags;
        changed.add("tags");
      }
    }
    if (task.dueDate !== due.dueDate || task.dueTime !== due.dueTime) {
      task.dueDate = due.dueDate;
      task.dueTime = due.dueTime;
      changed.add("due");
    }
    if (
      update.priority !== undefined &&
      task.priority !== update.priority
    ) {
      task.priority = update.priority;
      changed.add("priority");
    }
    if (
      update.flagged !== undefined &&
      task.flagged !== update.flagged
    ) {
      task.flagged = update.flagged;
      changed.add("flag");
    }
    if (update.url !== undefined) {
      if (task.url !== url) {
        task.url = url;
        changed.add("url");
      }
    }
    return [...changed];
  }

  private applyOccurrenceUpdate(
    occurrence: SyncedDailyOccurrence,
    update: TaskUpdate,
  ): DailyOccurrenceFieldGroup[] {
    const changed = new Set<DailyOccurrenceFieldGroup>();
    const tags =
      update.tags === undefined
        ? occurrence.tags
        : normalizeTags(update.tags);
    const due = normalizedDueUpdate(occurrence, update);
    const url =
      update.url === undefined
        ? occurrence.url
        : normalizeUrl(update.url);

    if (
      update.description !== undefined &&
      occurrence.description !== update.description
    ) {
      occurrence.description = update.description;
      changed.add("description");
    }
    if (update.tags !== undefined) {
      if (!sameStrings(occurrence.tags, tags)) {
        occurrence.tags = tags;
        changed.add("tags");
      }
    }
    if (
      occurrence.dueDate !== due.dueDate ||
      occurrence.dueTime !== due.dueTime
    ) {
      occurrence.dueDate = due.dueDate;
      occurrence.dueTime = due.dueTime;
      changed.add("due");
    }
    if (
      update.priority !== undefined &&
      occurrence.priority !== update.priority
    ) {
      occurrence.priority = update.priority;
      changed.add("priority");
    }
    if (
      update.flagged !== undefined &&
      occurrence.flagged !== update.flagged
    ) {
      occurrence.flagged = update.flagged;
      changed.add("flag");
    }
    if (update.url !== undefined) {
      if (occurrence.url !== url) {
        occurrence.url = url;
        changed.add("url");
      }
    }
    return [...changed];
  }

  private findTreeTask(id: string): SyncedTask | undefined {
    const task = this.data.tasks.find((candidate) => candidate.id === id);
    return task && isEntityPresent(this.data, "task", id)
      ? task
      : undefined;
  }

  private requireTreeTask(id: string): SyncedTask {
    const task = this.findTreeTask(id);
    if (!task) {
      if (this.findOccurrence(id)) {
        throw new TaskDomainError(
          "daily-task-invalid",
          "Daily task instances cannot be used in the task tree.",
        );
      }
      this.missingTask(id);
    }
    return task;
  }

  private findOccurrence(
    id: string,
  ): SyncedDailyOccurrence | undefined {
    const occurrence = this.data.dailyOccurrences.find(
      (candidate) => candidate.id === id,
    );
    return occurrence &&
      isEntityPresent(this.data, "daily-occurrence", id)
      ? occurrence
      : undefined;
  }

  private requireDailyTemplateRecord(id: string): SyncedDailyTemplate {
    const template = this.data.dailyTemplates.find(
      (candidate) => candidate.id === id,
    );
    if (
      !template ||
      !isEntityPresent(this.data, "daily-template", id)
    ) {
      throw new TaskDomainError(
        "daily-template-missing",
        `Daily template not found: ${id}`,
      );
    }
    return template;
  }

  private requireTaskView(id: string): TaskRecord {
    const task = this.getTask(id);
    if (!task) {
      this.missingTask(id);
    }
    return task;
  }

  private requireDailyTemplateView(id: string): DailyTaskTemplate {
    const template = this.getDailyTemplates().find(
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
    if (this.findOccurrence(id)) {
      return [id];
    }
    this.requireTreeTask(id);
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
    if (this.findOccurrence(id)) {
      return [id];
    }
    this.requireTreeTask(id);
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
    version: VersionStamp,
  ): void {
    let currentId = parentId;
    while (currentId !== null) {
      const parent = this.requireTreeTask(currentId);
      const children = this.orderedMutableChildren(parent.id);
      if (children.length > 0) {
        const completed = children.every((child) => child.completed);
        if (parent.completed !== completed) {
          parent.completed = completed;
          parent.completedAt = completed ? timestamp : null;
          parent.updatedAt = timestamp;
          parent.fieldVersions.completion = cloneVersion(version);
        }
      }
      currentId = parent.parentId;
    }
  }

  private orderedMutableChildren(
    parentId: string | null,
  ): SyncedTask[] {
    return this.activeTreeTasks()
      .filter((task) => task.parentId === parentId)
      .sort(comparePositioned);
  }

  private orderedMutableTemplates(): SyncedDailyTemplate[] {
    return this.data.dailyTemplates
      .filter((template) =>
        isEntityPresent(this.data, "daily-template", template.id),
      )
      .sort(comparePositioned);
  }

  private activeTreeTasks(): SyncedTask[] {
    return this.data.tasks.filter((task) =>
      isEntityPresent(this.data, "task", task.id),
    );
  }

  private activeOccurrences(): SyncedDailyOccurrence[] {
    return this.data.dailyOccurrences.filter((occurrence) =>
      isEntityPresent(this.data, "daily-occurrence", occurrence.id),
    );
  }

  private commit(change: HistoryChange): void {
    const after = clonePluginDataV3(this.data);
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

  private applyHistoryTarget(target: PluginDataV3): void {
    const timestamp = this.now();
    const version = this.nextVersion();

    this.applyTaskHistoryTarget(target, timestamp, version);
    this.applyDailyTemplateHistoryTarget(
      target,
      timestamp,
      version,
    );
    this.applyDailyOccurrenceHistoryTarget(
      target,
      timestamp,
      version,
    );
    this.historyBaseline = clonePluginDataV3(this.data);
    this.notifyAndPersist();
  }

  private applyTaskHistoryTarget(
    target: PluginDataV3,
    timestamp: number,
    version: VersionStamp,
  ): void {
    const currentById = new Map(
      this.data.tasks.map((task) => [task.id, task]),
    );
    const targetById = new Map(
      target.tasks.map((task) => [task.id, task]),
    );

    for (const id of unionIds(currentById, targetById)) {
      let current = currentById.get(id);
      const desired = targetById.get(id);
      const currentIsPresent =
        current !== undefined &&
        isEntityPresent(this.data, "task", id);
      const desiredIsPresent =
        desired !== undefined &&
        isEntityPresent(target, "task", id);

      if (!desiredIsPresent || !desired) {
        if (currentIsPresent) {
          this.tombstoneEntity("task", id, version, timestamp);
        }
        continue;
      }

      if (!current) {
        current = cloneTaskForHistory(desired, version, timestamp);
        this.data.tasks.push(current);
        currentById.set(id, current);
        continue;
      }

      if (!currentIsPresent) {
        restoreTaskForHistory(
          current,
          desired,
          version,
          timestamp,
        );
        continue;
      }

      if (applyTaskFieldHistory(current, desired, version)) {
        current.updatedAt = timestamp;
      }
    }
  }

  private applyDailyTemplateHistoryTarget(
    target: PluginDataV3,
    timestamp: number,
    version: VersionStamp,
  ): void {
    const currentById = new Map(
      this.data.dailyTemplates.map((template) => [
        template.id,
        template,
      ]),
    );
    const targetById = new Map(
      target.dailyTemplates.map((template) => [
        template.id,
        template,
      ]),
    );

    for (const id of unionIds(currentById, targetById)) {
      let current = currentById.get(id);
      const desired = targetById.get(id);
      const currentIsPresent =
        current !== undefined &&
        isEntityPresent(this.data, "daily-template", id);
      const desiredIsPresent =
        desired !== undefined &&
        isEntityPresent(target, "daily-template", id);

      if (!desiredIsPresent || !desired) {
        if (currentIsPresent) {
          this.tombstoneEntity(
            "daily-template",
            id,
            version,
            timestamp,
          );
        }
        continue;
      }

      if (!current) {
        current = cloneDailyTemplateForHistory(
          desired,
          version,
          timestamp,
        );
        this.data.dailyTemplates.push(current);
        currentById.set(id, current);
        continue;
      }

      if (!currentIsPresent) {
        restoreDailyTemplateForHistory(
          current,
          desired,
          version,
          timestamp,
        );
        continue;
      }

      let changed = false;
      if (current.title !== desired.title) {
        current.title = desired.title;
        current.fieldVersions.title = cloneVersion(version);
        changed = true;
      }
      if (current.positionKey !== desired.positionKey) {
        current.positionKey = desired.positionKey;
        current.fieldVersions.position = cloneVersion(version);
        changed = true;
      }
      if (changed) {
        current.updatedAt = timestamp;
      }
    }
  }

  private applyDailyOccurrenceHistoryTarget(
    target: PluginDataV3,
    timestamp: number,
    version: VersionStamp,
  ): void {
    const currentById = new Map(
      this.data.dailyOccurrences.map((occurrence) => [
        occurrence.id,
        occurrence,
      ]),
    );
    const targetById = new Map(
      target.dailyOccurrences.map((occurrence) => [
        occurrence.id,
        occurrence,
      ]),
    );

    for (const id of unionIds(currentById, targetById)) {
      let current = currentById.get(id);
      const desired = targetById.get(id);
      const currentIsPresent =
        current !== undefined &&
        isEntityPresent(this.data, "daily-occurrence", id);
      const desiredIsPresent =
        desired !== undefined &&
        isEntityPresent(target, "daily-occurrence", id);

      if (!desiredIsPresent || !desired) {
        if (currentIsPresent) {
          this.tombstoneEntity(
            "daily-occurrence",
            id,
            version,
            timestamp,
          );
        }
        continue;
      }

      if (!current) {
        current = cloneDailyOccurrenceForHistory(
          desired,
          version,
          timestamp,
        );
        this.data.dailyOccurrences.push(current);
        currentById.set(id, current);
        continue;
      }

      if (!currentIsPresent) {
        restoreDailyOccurrenceForHistory(
          current,
          desired,
          version,
          timestamp,
        );
        continue;
      }

      if (
        applyDailyOccurrenceFieldHistory(
          current,
          desired,
          version,
        )
      ) {
        current.updatedAt = timestamp;
      }
    }
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

  private createDailyOccurrence(
    template: SyncedDailyTemplate,
    date: string,
    timestamp: number,
    version: VersionStamp,
  ): SyncedDailyOccurrence {
    const id = createDailyOccurrenceId(template.id, date);
    const existing = this.data.dailyOccurrences.find(
      (occurrence) => occurrence.id === id,
    );
    if (existing) {
      existing.existence = cloneVersion(version);
      existing.completed = false;
      existing.completedAt = null;
      existing.description = "";
      existing.tags = [];
      existing.dueDate = null;
      existing.dueTime = null;
      existing.priority = "none";
      existing.flagged = false;
      existing.url = null;
      existing.createdAt = timestamp;
      existing.updatedAt = timestamp;
      existing.todayAddedAt = timestamp;
      existing.fieldVersions = createOccurrenceFieldVersions(version);
      return existing;
    }

    const occurrence: SyncedDailyOccurrence = {
      id,
      templateId: template.id,
      date,
      completed: false,
      description: "",
      tags: [],
      dueDate: null,
      dueTime: null,
      priority: "none",
      flagged: false,
      url: null,
      completedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      todayAddedAt: timestamp,
      existence: cloneVersion(version),
      fieldVersions: createOccurrenceFieldVersions(version),
    };
    this.data.dailyOccurrences.push(occurrence);
    return occurrence;
  }

  private tombstoneEntity(
    entityType: "task" | "daily-template" | "daily-occurrence",
    id: string,
    version: VersionStamp,
    timestamp: number,
  ): void {
    const existing = this.data.entityTombstones.find(
      (tombstone) =>
        tombstone.entityType === entityType && tombstone.id === id,
    );
    if (existing) {
      existing.deleted = cloneVersion(version);
      existing.deletedAt = timestamp;
    } else {
      this.data.entityTombstones.push({
        entityType,
        id,
        deleted: cloneVersion(version),
        deletedAt: timestamp,
      });
    }
  }

  private nextVersion(): VersionStamp {
    this.data.clock += 1;
    return {
      counter: this.data.clock,
      actorId: this.actorId,
    };
  }

  private createUniqueId(): string {
    return this.idFactory();
  }

  private requireUniqueId(id: string): void {
    if (
      this.data.tasks.some((task) => task.id === id) ||
      this.data.dailyTemplates.some((template) => template.id === id) ||
      this.data.dailyOccurrences.some(
        (occurrence) => occurrence.id === id,
      ) ||
      this.data.entityTombstones.some(
        (tombstone) => tombstone.id === id,
      )
    ) {
      throw new TaskDomainError(
        "duplicate-id",
        `Task ID already exists: ${id}`,
      );
    }
  }

  private missingTask(id: string): never {
    throw new TaskDomainError(
      "task-missing",
      `Task not found: ${id}`,
    );
  }
}

function unionIds<T>(
  left: ReadonlyMap<string, T>,
  right: ReadonlyMap<string, T>,
): Set<string> {
  return new Set([...left.keys(), ...right.keys()]);
}

function cloneTaskForHistory(
  desired: SyncedTask,
  version: VersionStamp,
  timestamp: number,
): SyncedTask {
  return {
    ...desired,
    tags: [...desired.tags],
    attachments: desired.attachments.map((attachment) => ({
      ...attachment,
      added: cloneVersion(attachment.added),
    })),
    updatedAt: timestamp,
    existence: cloneVersion(version),
    fieldVersions: createTaskFieldVersions(version),
  };
}

function restoreTaskForHistory(
  current: SyncedTask,
  desired: SyncedTask,
  version: VersionStamp,
  timestamp: number,
): void {
  current.parentId = desired.parentId;
  current.positionKey = desired.positionKey;
  current.title = desired.title;
  current.completed = desired.completed;
  current.description = desired.description;
  current.tags = [...desired.tags];
  current.dueDate = desired.dueDate;
  current.dueTime = desired.dueTime;
  current.priority = desired.priority;
  current.flagged = desired.flagged;
  current.url = desired.url;
  current.attachments = desired.attachments.map((attachment) => ({
    ...attachment,
    added: cloneVersion(attachment.added),
  }));
  current.createdAt = desired.createdAt;
  current.updatedAt = timestamp;
  current.completedAt = desired.completedAt;
  current.today = desired.today;
  current.todayAddedAt = desired.todayAddedAt;
  current.existence = cloneVersion(version);
  current.fieldVersions = createTaskFieldVersions(version);
}

function applyTaskFieldHistory(
  current: SyncedTask,
  desired: SyncedTask,
  version: VersionStamp,
): boolean {
  let changed = false;
  if (current.title !== desired.title) {
    current.title = desired.title;
    current.fieldVersions.title = cloneVersion(version);
    changed = true;
  }
  if (current.description !== desired.description) {
    current.description = desired.description;
    current.fieldVersions.description = cloneVersion(version);
    changed = true;
  }
  if (!sameStrings(current.tags, desired.tags)) {
    current.tags = [...desired.tags];
    current.fieldVersions.tags = cloneVersion(version);
    changed = true;
  }
  if (
    current.dueDate !== desired.dueDate ||
    current.dueTime !== desired.dueTime
  ) {
    current.dueDate = desired.dueDate;
    current.dueTime = desired.dueTime;
    current.fieldVersions.due = cloneVersion(version);
    changed = true;
  }
  if (current.priority !== desired.priority) {
    current.priority = desired.priority;
    current.fieldVersions.priority = cloneVersion(version);
    changed = true;
  }
  if (current.flagged !== desired.flagged) {
    current.flagged = desired.flagged;
    current.fieldVersions.flag = cloneVersion(version);
    changed = true;
  }
  if (current.url !== desired.url) {
    current.url = desired.url;
    current.fieldVersions.url = cloneVersion(version);
    changed = true;
  }
  if (
    current.completed !== desired.completed ||
    current.completedAt !== desired.completedAt
  ) {
    current.completed = desired.completed;
    current.completedAt = desired.completedAt;
    current.fieldVersions.completion = cloneVersion(version);
    changed = true;
  }
  if (
    current.today !== desired.today ||
    current.todayAddedAt !== desired.todayAddedAt
  ) {
    current.today = desired.today;
    current.todayAddedAt = desired.todayAddedAt;
    current.fieldVersions.today = cloneVersion(version);
    changed = true;
  }
  if (
    current.parentId !== desired.parentId ||
    current.positionKey !== desired.positionKey
  ) {
    current.parentId = desired.parentId;
    current.positionKey = desired.positionKey;
    current.fieldVersions.structure = cloneVersion(version);
    changed = true;
  }
  return changed;
}

function cloneDailyTemplateForHistory(
  desired: SyncedDailyTemplate,
  version: VersionStamp,
  timestamp: number,
): SyncedDailyTemplate {
  return {
    ...desired,
    updatedAt: timestamp,
    existence: cloneVersion(version),
    fieldVersions: {
      title: cloneVersion(version),
      position: cloneVersion(version),
    },
  };
}

function restoreDailyTemplateForHistory(
  current: SyncedDailyTemplate,
  desired: SyncedDailyTemplate,
  version: VersionStamp,
  timestamp: number,
): void {
  current.title = desired.title;
  current.positionKey = desired.positionKey;
  current.createdAt = desired.createdAt;
  current.updatedAt = timestamp;
  current.existence = cloneVersion(version);
  current.fieldVersions = {
    title: cloneVersion(version),
    position: cloneVersion(version),
  };
}

function cloneDailyOccurrenceForHistory(
  desired: SyncedDailyOccurrence,
  version: VersionStamp,
  timestamp: number,
): SyncedDailyOccurrence {
  return {
    ...desired,
    tags: [...desired.tags],
    updatedAt: timestamp,
    existence: cloneVersion(version),
    fieldVersions: createOccurrenceFieldVersions(version),
  };
}

function restoreDailyOccurrenceForHistory(
  current: SyncedDailyOccurrence,
  desired: SyncedDailyOccurrence,
  version: VersionStamp,
  timestamp: number,
): void {
  current.templateId = desired.templateId;
  current.date = desired.date;
  current.completed = desired.completed;
  current.description = desired.description;
  current.tags = [...desired.tags];
  current.dueDate = desired.dueDate;
  current.dueTime = desired.dueTime;
  current.priority = desired.priority;
  current.flagged = desired.flagged;
  current.url = desired.url;
  current.completedAt = desired.completedAt;
  current.createdAt = desired.createdAt;
  current.updatedAt = timestamp;
  current.todayAddedAt = desired.todayAddedAt;
  current.existence = cloneVersion(version);
  current.fieldVersions = createOccurrenceFieldVersions(version);
}

function applyDailyOccurrenceFieldHistory(
  current: SyncedDailyOccurrence,
  desired: SyncedDailyOccurrence,
  version: VersionStamp,
): boolean {
  let changed = false;
  if (current.description !== desired.description) {
    current.description = desired.description;
    current.fieldVersions.description = cloneVersion(version);
    changed = true;
  }
  if (!sameStrings(current.tags, desired.tags)) {
    current.tags = [...desired.tags];
    current.fieldVersions.tags = cloneVersion(version);
    changed = true;
  }
  if (
    current.dueDate !== desired.dueDate ||
    current.dueTime !== desired.dueTime
  ) {
    current.dueDate = desired.dueDate;
    current.dueTime = desired.dueTime;
    current.fieldVersions.due = cloneVersion(version);
    changed = true;
  }
  if (current.priority !== desired.priority) {
    current.priority = desired.priority;
    current.fieldVersions.priority = cloneVersion(version);
    changed = true;
  }
  if (current.flagged !== desired.flagged) {
    current.flagged = desired.flagged;
    current.fieldVersions.flag = cloneVersion(version);
    changed = true;
  }
  if (current.url !== desired.url) {
    current.url = desired.url;
    current.fieldVersions.url = cloneVersion(version);
    changed = true;
  }
  if (
    current.completed !== desired.completed ||
    current.completedAt !== desired.completedAt
  ) {
    current.completed = desired.completed;
    current.completedAt = desired.completedAt;
    current.fieldVersions.completion = cloneVersion(version);
    changed = true;
  }
  return changed;
}

function createTaskFieldVersions(
  version: VersionStamp,
): SyncedTask["fieldVersions"] {
  return {
    title: cloneVersion(version),
    description: cloneVersion(version),
    tags: cloneVersion(version),
    due: cloneVersion(version),
    priority: cloneVersion(version),
    flag: cloneVersion(version),
    url: cloneVersion(version),
    completion: cloneVersion(version),
    today: cloneVersion(version),
    structure: cloneVersion(version),
  };
}

function createOccurrenceFieldVersions(
  version: VersionStamp,
): SyncedDailyOccurrence["fieldVersions"] {
  return {
    description: cloneVersion(version),
    tags: cloneVersion(version),
    due: cloneVersion(version),
    priority: cloneVersion(version),
    flag: cloneVersion(version),
    url: cloneVersion(version),
    completion: cloneVersion(version),
  };
}

function normalizedDueUpdate(
  task: {
    dueDate: string | null;
    dueTime: string | null;
  },
  update: TaskUpdate,
): {
  dueDate: string | null;
  dueTime: string | null;
} {
  const dueDate =
    update.dueDate === undefined
      ? task.dueDate
      : normalizeDueDate(update.dueDate);
  const requestedDueTime =
    update.dueTime === undefined
      ? task.dueTime
      : normalizeDueTime(update.dueTime);
  return {
    dueDate,
    dueTime: dueDate === null ? null : requestedDueTime,
  };
}

function comparePositioned(
  left: { id: string; positionKey: string },
  right: { id: string; positionKey: string },
): number {
  const position = comparePositionKeys(
    left.positionKey,
    right.positionKey,
  );
  if (position !== 0) {
    return position;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
