import {
  PluginData,
  Priority,
  TaskAttachment,
  TaskDomainError,
  TaskRecord,
  MAX_TASK_DEPTH,
} from "./task";

const PRIORITIES = new Set<Priority>([
  "none",
  "low",
  "medium",
  "high",
]);
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function createDefaultPluginData(): PluginData {
  return {
    schemaVersion: 1,
    showCompleted: false,
    tasks: [],
  };
}

export function clonePluginData(data: PluginData): PluginData {
  return {
    schemaVersion: 1,
    showCompleted: data.showCompleted,
    tasks: data.tasks.map((task) => ({
      ...task,
      tags: [...task.tags],
      attachments: task.attachments.map((attachment) => ({
        ...attachment,
      })),
    })),
  };
}

export function parsePluginData(value: unknown): PluginData {
  if (value === null || value === undefined) {
    return createDefaultPluginData();
  }

  if (!isRecord(value)) {
    invalid("Stored plugin data must be an object.");
  }
  if (value.schemaVersion !== 1) {
    invalid("Unsupported Miller Tasks data version.");
  }
  if (typeof value.showCompleted !== "boolean") {
    invalid("showCompleted must be a boolean.");
  }
  if (!Array.isArray(value.tasks)) {
    invalid("tasks must be an array.");
  }

  const tasks = value.tasks.map((task, index) =>
    parseTask(task, index),
  );
  validateGraph(tasks);

  return clonePluginData({
    schemaVersion: 1,
    showCompleted: value.showCompleted,
    tasks,
  });
}

export function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (normalized.length === 0) {
    throw new TaskDomainError(
      "title-empty",
      "Task title cannot be empty.",
    );
  }
  return normalized;
}

export function normalizeTags(tags: readonly string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const sourceTag of tags) {
    const tag = sourceTag
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "-");
    const key = tag.toLocaleLowerCase();
    if (tag.length > 0 && !seen.has(key)) {
      normalized.push(tag);
      seen.add(key);
    }
  }

  return normalized;
}

export function normalizeDueDate(
  dueDate: string | null,
): string | null {
  if (dueDate === null || dueDate === "") {
    return null;
  }

  const match = DATE_PATTERN.exec(dueDate);
  if (!match) {
    throw new TaskDomainError(
      "date-invalid",
      "Due date must use YYYY-MM-DD.",
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new TaskDomainError(
      "date-invalid",
      "Due date is not a valid calendar date.",
    );
  }

  return dueDate;
}

export function normalizeDueTime(
  dueTime: string | null,
): string | null {
  if (dueTime === null || dueTime === "") {
    return null;
  }
  if (!TIME_PATTERN.test(dueTime)) {
    throw new TaskDomainError(
      "time-invalid",
      "Due time must use HH:mm.",
    );
  }
  return dueTime;
}

export function normalizeUrl(url: string | null): string | null {
  if (url === null || url.trim() === "") {
    return null;
  }

  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw new TaskDomainError(
      "url-invalid",
      "URL must be an absolute HTTP or HTTPS address.",
    );
  }
}

export function normalizeAttachment(
  attachment: TaskAttachment,
): TaskAttachment {
  if (
    attachment.id.trim() === "" ||
    attachment.path.trim() === "" ||
    attachment.name.trim() === "" ||
    !attachment.mimeType.startsWith("image/") ||
    !isTimestamp(attachment.createdAt)
  ) {
    throw new TaskDomainError(
      "attachment-invalid",
      "Task attachment is invalid.",
    );
  }

  return {
    ...attachment,
    id: attachment.id.trim(),
    path: attachment.path.trim(),
    name: attachment.name.trim(),
    mimeType: attachment.mimeType.trim(),
  };
}

function parseTask(value: unknown, index: number): TaskRecord {
  if (!isRecord(value)) {
    invalid(`Task at index ${index} must be an object.`);
  }

  const requiredStrings = [
    "id",
    "title",
    "description",
  ] as const;
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string") {
      invalid(`Task ${index} field ${field} must be a string.`);
    }
  }

  if (
    value.parentId !== null &&
    typeof value.parentId !== "string"
  ) {
    invalid(`Task ${index} parentId is invalid.`);
  }
  if (
    typeof value.completed !== "boolean" ||
    typeof value.flagged !== "boolean"
  ) {
    invalid(`Task ${index} completion fields are invalid.`);
  }
  if (!Array.isArray(value.tags)) {
    invalid(`Task ${index} tags must be an array.`);
  }
  if (!value.tags.every((tag) => typeof tag === "string")) {
    invalid(`Task ${index} contains an invalid tag.`);
  }
  if (!Array.isArray(value.attachments)) {
    invalid(`Task ${index} attachments must be an array.`);
  }
  if (
    value.dueDate !== null &&
    typeof value.dueDate !== "string"
  ) {
    invalid(`Task ${index} dueDate is invalid.`);
  }
  if (
    value.dueTime !== null &&
    typeof value.dueTime !== "string"
  ) {
    invalid(`Task ${index} dueTime is invalid.`);
  }
  if (value.url !== null && typeof value.url !== "string") {
    invalid(`Task ${index} URL is invalid.`);
  }
  if (
    typeof value.priority !== "string" ||
    !PRIORITIES.has(value.priority as Priority)
  ) {
    invalid(`Task ${index} priority is invalid.`);
  }
  if (!Number.isInteger(value.order) || Number(value.order) < 0) {
    invalid(`Task ${index} order is invalid.`);
  }
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) {
    invalid(`Task ${index} timestamps are invalid.`);
  }
  if (
    value.completedAt !== null &&
    !isTimestamp(value.completedAt)
  ) {
    invalid(`Task ${index} completedAt is invalid.`);
  }
  if (
    (value.completed && value.completedAt === null) ||
    (!value.completed && value.completedAt !== null)
  ) {
    invalid(`Task ${index} completion timestamp is inconsistent.`);
  }

  const dueDate = normalizeDueDate(value.dueDate);
  const dueTime = normalizeDueTime(value.dueTime);
  if (dueTime !== null && dueDate === null) {
    invalid(`Task ${index} cannot have a due time without a date.`);
  }

  return {
    id: normalizeTitle(value.id as string),
    parentId: value.parentId,
    title: normalizeTitle(value.title as string),
    completed: value.completed,
    description: value.description as string,
    tags: normalizeTags(value.tags),
    dueDate,
    dueTime,
    priority: value.priority as Priority,
    flagged: value.flagged,
    url: normalizeUrl(value.url),
    attachments: value.attachments.map((attachment) =>
      parseAttachment(attachment, index),
    ),
    order: Number(value.order),
    createdAt: Number(value.createdAt),
    updatedAt: Number(value.updatedAt),
    completedAt:
      value.completedAt === null ? null : Number(value.completedAt),
  };
}

function parseAttachment(
  value: unknown,
  taskIndex: number,
): TaskAttachment {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.path !== "string" ||
    typeof value.name !== "string" ||
    typeof value.mimeType !== "string" ||
    !isTimestamp(value.createdAt)
  ) {
    invalid(`Task ${taskIndex} contains an invalid attachment.`);
  }

  return normalizeAttachment({
    id: value.id,
    path: value.path,
    name: value.name,
    mimeType: value.mimeType,
    createdAt: value.createdAt,
  });
}

function validateGraph(tasks: readonly TaskRecord[]): void {
  const byId = new Map<string, TaskRecord>();
  for (const task of tasks) {
    if (byId.has(task.id)) {
      throw new TaskDomainError(
        "duplicate-id",
        `Duplicate task ID: ${task.id}`,
      );
    }
    byId.set(task.id, task);
  }

  for (const task of tasks) {
    if (task.parentId !== null && !byId.has(task.parentId)) {
      throw new TaskDomainError(
        "parent-missing",
        `Task ${task.id} has a missing parent.`,
      );
    }

    const visited = new Set<string>();
    let current: TaskRecord | undefined = task;
    let depth = 0;
    while (current) {
      if (visited.has(current.id)) {
        throw new TaskDomainError(
          "cycle",
          `Task ${task.id} is part of a cycle.`,
        );
      }
      visited.add(current.id);
      depth += 1;
      if (depth > MAX_TASK_DEPTH) {
        throw new TaskDomainError(
          "depth-exceeded",
          `Task ${task.id} exceeds depth ${MAX_TASK_DEPTH}.`,
        );
      }
      current =
        current.parentId === null
          ? undefined
          : byId.get(current.parentId);
    }
  }

  const siblingOrders = new Map<string, number[]>();
  for (const task of tasks) {
    const key = task.parentId ?? "__root__";
    const orders = siblingOrders.get(key) ?? [];
    orders.push(task.order);
    siblingOrders.set(key, orders);
  }
  for (const orders of siblingOrders.values()) {
    orders.sort((left, right) => left - right);
    orders.forEach((order, index) => {
      if (order !== index) {
        invalid("Sibling task order must be contiguous and unique.");
      }
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function invalid(message: string): never {
  throw new TaskDomainError("data-invalid", message);
}
