import {
  normalizeAttachment,
  normalizeDueDate,
  normalizeDueTime,
  normalizeTags,
  normalizeTitle,
  normalizeUrl,
} from "../domain/pluginData";
import {
  Priority,
  TaskDomainError,
} from "../domain/task";
import { validatePositionKey } from "./positionKey";
import {
  AttachmentTombstone,
  canonicalizePluginDataV3,
  ConflictTombstone,
  DailyOccurrenceFieldGroup,
  DailyOccurrenceFieldVersions,
  DailyTemplateFieldVersions,
  EntityTombstone,
  EntityType,
  JsonValue,
  migratePluginDataToV3,
  PluginDataV3,
  SyncConflict,
  SyncedAttachment,
  SyncedDailyOccurrence,
  SyncedDailyTemplate,
  SyncedTask,
  SYNC_SCHEMA_VERSION,
  TaskFieldGroup,
  TaskFieldVersions,
  VersionStamp,
} from "./syncData";

const PRIORITIES = new Set<Priority>([
  "none",
  "low",
  "medium",
  "high",
]);
const TASK_FIELD_GROUPS: readonly TaskFieldGroup[] = [
  "title",
  "description",
  "tags",
  "due",
  "priority",
  "flag",
  "url",
  "completion",
  "today",
  "structure",
];
const OCCURRENCE_FIELD_GROUPS: readonly DailyOccurrenceFieldGroup[] = [
  "description",
  "tags",
  "due",
  "priority",
  "flag",
  "url",
  "completion",
];
const ENTITY_TYPES = new Set<EntityType>([
  "task",
  "daily-template",
  "daily-occurrence",
]);

export function parseOrMigratePluginDataV3(
  value: unknown,
): PluginDataV3 {
  if (!isRecord(value) || value.schemaVersion !== SYNC_SCHEMA_VERSION) {
    return migratePluginDataToV3(value);
  }
  return parsePluginDataV3(value);
}

export function parsePluginDataV3(value: unknown): PluginDataV3 {
  if (!isRecord(value) || value.schemaVersion !== SYNC_SCHEMA_VERSION) {
    invalid("Stored synchronization data must use schema version 3.");
  }
  if (
    !isCounter(value.clock) ||
    typeof value.showCompleted !== "boolean" ||
    !Array.isArray(value.tasks) ||
    !Array.isArray(value.dailyTemplates) ||
    !Array.isArray(value.dailyOccurrences) ||
    !Array.isArray(value.entityTombstones) ||
    !Array.isArray(value.attachmentTombstones) ||
    !Array.isArray(value.conflicts) ||
    !Array.isArray(value.conflictTombstones)
  ) {
    invalid("Stored schema-v3 synchronization data is incomplete.");
  }

  const parsed = canonicalizePluginDataV3({
    schemaVersion: SYNC_SCHEMA_VERSION,
    clock: value.clock,
    showCompleted: value.showCompleted,
    showCompletedVersion: parseVersion(
      value.showCompletedVersion,
      "showCompletedVersion",
    ),
    tasks: value.tasks.map(parseTask),
    dailyTemplates: value.dailyTemplates.map(parseDailyTemplate),
    dailyOccurrences: value.dailyOccurrences.map(parseDailyOccurrence),
    entityTombstones: value.entityTombstones.map(parseEntityTombstone),
    attachmentTombstones: value.attachmentTombstones.map(
      parseAttachmentTombstone,
    ),
    conflicts: value.conflicts.map(parseConflict),
    conflictTombstones: value.conflictTombstones.map(
      parseConflictTombstone,
    ),
  });

  validateUniqueRecords(parsed);
  if (parsed.clock < maximumCounter(parsed)) {
    invalid("Stored synchronization clock is behind entity versions.");
  }
  return parsed;
}

function parseTask(value: unknown, index: number): SyncedTask {
  const label = `Task ${index}`;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.description !== "string" ||
    typeof value.positionKey !== "string" ||
    (value.parentId !== null && typeof value.parentId !== "string") ||
    typeof value.completed !== "boolean" ||
    typeof value.flagged !== "boolean" ||
    typeof value.today !== "boolean" ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string") ||
    !Array.isArray(value.attachments) ||
    !isPriority(value.priority) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    (value.completedAt !== null && !isTimestamp(value.completedAt)) ||
    (value.todayAddedAt !== null && !isTimestamp(value.todayAddedAt)) ||
    (value.dueDate !== null && typeof value.dueDate !== "string") ||
    (value.dueTime !== null && typeof value.dueTime !== "string") ||
    (value.url !== null && typeof value.url !== "string")
  ) {
    invalid(`${label} is invalid.`);
  }
  validatePosition(value.positionKey, label);
  validateCompletion(
    value.completed,
    value.completedAt,
    `${label} completion`,
  );
  validateToday(value.today, value.todayAddedAt, label);
  const dueDate = normalizeDueDate(value.dueDate);
  const dueTime = normalizeDueTime(value.dueTime);
  if (dueTime !== null && dueDate === null) {
    invalid(`${label} cannot have a due time without a date.`);
  }

  return {
    id: normalizeTitle(value.id),
    parentId:
      value.parentId === null ? null : normalizeTitle(value.parentId),
    positionKey: value.positionKey,
    title: normalizeTitle(value.title),
    completed: value.completed,
    description: value.description,
    tags: normalizeTags(value.tags),
    dueDate,
    dueTime,
    priority: value.priority,
    flagged: value.flagged,
    url: normalizeUrl(value.url),
    attachments: value.attachments.map((attachment, attachmentIndex) =>
      parseAttachment(attachment, `${label} attachment ${attachmentIndex}`),
    ),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    completedAt: value.completedAt,
    today: value.today,
    todayAddedAt: value.todayAddedAt,
    existence: parseVersion(value.existence, `${label} existence`),
    fieldVersions: parseTaskFieldVersions(
      value.fieldVersions,
      `${label} field versions`,
    ),
  };
}

function parseAttachment(
  value: unknown,
  label: string,
): SyncedAttachment {
  if (!isRecord(value)) {
    invalid(`${label} is invalid.`);
  }
  const normalized = normalizeAttachment({
    id: requiredString(value.id, `${label} id`),
    path: requiredString(value.path, `${label} path`),
    name: requiredString(value.name, `${label} name`),
    mimeType: requiredString(value.mimeType, `${label} MIME type`),
    createdAt: requiredTimestamp(value.createdAt, `${label} createdAt`),
  });
  return {
    ...normalized,
    added: parseVersion(value.added, `${label} added version`),
  };
}

function parseDailyTemplate(
  value: unknown,
  index: number,
): SyncedDailyTemplate {
  const label = `Daily template ${index}`;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.positionKey !== "string" ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt)
  ) {
    invalid(`${label} is invalid.`);
  }
  validatePosition(value.positionKey, label);
  return {
    id: normalizeTitle(value.id),
    title: normalizeTitle(value.title),
    positionKey: value.positionKey,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    existence: parseVersion(value.existence, `${label} existence`),
    fieldVersions: parseTemplateFieldVersions(
      value.fieldVersions,
      `${label} field versions`,
    ),
  };
}

function parseDailyOccurrence(
  value: unknown,
  index: number,
): SyncedDailyOccurrence {
  const label = `Daily occurrence ${index}`;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.templateId !== "string" ||
    typeof value.date !== "string" ||
    typeof value.description !== "string" ||
    typeof value.completed !== "boolean" ||
    typeof value.flagged !== "boolean" ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === "string") ||
    !isPriority(value.priority) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    !isTimestamp(value.todayAddedAt) ||
    (value.completedAt !== null && !isTimestamp(value.completedAt)) ||
    (value.dueDate !== null && typeof value.dueDate !== "string") ||
    (value.dueTime !== null && typeof value.dueTime !== "string") ||
    (value.url !== null && typeof value.url !== "string")
  ) {
    invalid(`${label} is invalid.`);
  }
  validateCompletion(
    value.completed,
    value.completedAt,
    `${label} completion`,
  );
  const date = normalizeDueDate(value.date);
  const dueDate = normalizeDueDate(value.dueDate);
  const dueTime = normalizeDueTime(value.dueTime);
  if (date === null || (dueTime !== null && dueDate === null)) {
    invalid(`${label} dates are invalid.`);
  }
  const templateId = normalizeTitle(value.templateId);
  const id = normalizeTitle(value.id);
  if (id !== `${templateId}:${date}`) {
    invalid(`${label} ID does not match its template and date.`);
  }

  return {
    id,
    templateId,
    date,
    completed: value.completed,
    description: value.description,
    tags: normalizeTags(value.tags),
    dueDate,
    dueTime,
    priority: value.priority,
    flagged: value.flagged,
    url: normalizeUrl(value.url),
    completedAt: value.completedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    todayAddedAt: value.todayAddedAt,
    existence: parseVersion(value.existence, `${label} existence`),
    fieldVersions: parseOccurrenceFieldVersions(
      value.fieldVersions,
      `${label} field versions`,
    ),
  };
}

function parseEntityTombstone(
  value: unknown,
  index: number,
): EntityTombstone {
  const label = `Entity tombstone ${index}`;
  if (
    !isRecord(value) ||
    typeof value.entityType !== "string" ||
    !ENTITY_TYPES.has(value.entityType as EntityType)
  ) {
    invalid(`${label} is invalid.`);
  }
  return {
    entityType: value.entityType as EntityType,
    id: normalizeTitle(requiredString(value.id, `${label} id`)),
    deleted: parseVersion(value.deleted, `${label} deleted version`),
    deletedAt: requiredTimestamp(value.deletedAt, `${label} deletedAt`),
  };
}

function parseAttachmentTombstone(
  value: unknown,
  index: number,
): AttachmentTombstone {
  const label = `Attachment tombstone ${index}`;
  if (!isRecord(value)) {
    invalid(`${label} is invalid.`);
  }
  return {
    taskId: normalizeTitle(
      requiredString(value.taskId, `${label} taskId`),
    ),
    attachmentId: normalizeTitle(
      requiredString(value.attachmentId, `${label} attachmentId`),
    ),
    removed: parseVersion(value.removed, `${label} removed version`),
    removedAt: requiredTimestamp(value.removedAt, `${label} removedAt`),
  };
}

function parseConflict(value: unknown, index: number): SyncConflict {
  const label = `Sync conflict ${index}`;
  if (
    !isRecord(value) ||
    typeof value.entityType !== "string" ||
    !new Set([...ENTITY_TYPES, "plugin"]).has(value.entityType)
  ) {
    invalid(`${label} is invalid.`);
  }
  return {
    id: normalizeTitle(requiredString(value.id, `${label} id`)),
    entityType: value.entityType as SyncConflict["entityType"],
    entityId: normalizeTitle(
      requiredString(value.entityId, `${label} entityId`),
    ),
    fieldGroup: normalizeTitle(
      requiredString(value.fieldGroup, `${label} fieldGroup`),
    ),
    leftValue: parseJsonValue(value.leftValue, `${label} leftValue`),
    rightValue: parseJsonValue(value.rightValue, `${label} rightValue`),
    winner: parseVersion(value.winner, `${label} winner`),
    detected: parseVersion(value.detected, `${label} detected`),
  };
}

function parseConflictTombstone(
  value: unknown,
  index: number,
): ConflictTombstone {
  const label = `Conflict tombstone ${index}`;
  if (!isRecord(value)) {
    invalid(`${label} is invalid.`);
  }
  return {
    id: normalizeTitle(requiredString(value.id, `${label} id`)),
    dismissed: parseVersion(
      value.dismissed,
      `${label} dismissed version`,
    ),
    dismissedAt: requiredTimestamp(
      value.dismissedAt,
      `${label} dismissedAt`,
    ),
  };
}

function parseTaskFieldVersions(
  value: unknown,
  label: string,
): TaskFieldVersions {
  if (!isRecord(value)) {
    invalid(`${label} are invalid.`);
  }
  return Object.fromEntries(
    TASK_FIELD_GROUPS.map((group) => [
      group,
      parseVersion(value[group], `${label} ${group}`),
    ]),
  ) as TaskFieldVersions;
}

function parseTemplateFieldVersions(
  value: unknown,
  label: string,
): DailyTemplateFieldVersions {
  if (!isRecord(value)) {
    invalid(`${label} are invalid.`);
  }
  return {
    title: parseVersion(value.title, `${label} title`),
    position: parseVersion(value.position, `${label} position`),
  };
}

function parseOccurrenceFieldVersions(
  value: unknown,
  label: string,
): DailyOccurrenceFieldVersions {
  if (!isRecord(value)) {
    invalid(`${label} are invalid.`);
  }
  return Object.fromEntries(
    OCCURRENCE_FIELD_GROUPS.map((group) => [
      group,
      parseVersion(value[group], `${label} ${group}`),
    ]),
  ) as DailyOccurrenceFieldVersions;
}

function parseVersion(value: unknown, label: string): VersionStamp {
  if (
    !isRecord(value) ||
    !isCounter(value.counter) ||
    typeof value.actorId !== "string" ||
    value.actorId.trim() === ""
  ) {
    invalid(`${label} is invalid.`);
  }
  return {
    counter: value.counter,
    actorId: value.actorId,
  };
}

function parseJsonValue(value: unknown, label: string): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      parseJsonValue(child, `${label}[${index}]`),
    );
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        parseJsonValue(child, `${label}.${key}`),
      ]),
    );
  }
  invalid(`${label} is not valid JSON.`);
}

function validateUniqueRecords(data: PluginDataV3): void {
  requireUnique(data.tasks.map((task) => task.id), "task");
  requireUnique(
    data.dailyTemplates.map((template) => template.id),
    "daily template",
  );
  requireUnique(
    data.dailyOccurrences.map((occurrence) => occurrence.id),
    "daily occurrence",
  );
  for (const task of data.tasks) {
    requireUnique(
      task.attachments.map((attachment) => attachment.id),
      `attachment in task ${task.id}`,
    );
  }
  requireUnique(
    data.entityTombstones.map(
      (tombstone) => `${tombstone.entityType}:${tombstone.id}`,
    ),
    "entity tombstone",
  );
  requireUnique(
    data.attachmentTombstones.map(
      (tombstone) =>
        `${tombstone.taskId}:${tombstone.attachmentId}`,
    ),
    "attachment tombstone",
  );
  requireUnique(
    data.conflicts.map((conflict) => conflict.id),
    "sync conflict",
  );
  requireUnique(
    data.conflictTombstones.map((tombstone) => tombstone.id),
    "conflict tombstone",
  );
}

function maximumCounter(data: PluginDataV3): number {
  return Math.max(
    data.showCompletedVersion.counter,
    ...data.tasks.flatMap((task) => [
      task.existence.counter,
      ...Object.values(task.fieldVersions).map(
        (version) => version.counter,
      ),
      ...task.attachments.map(
        (attachment) => attachment.added.counter,
      ),
    ]),
    ...data.dailyTemplates.flatMap((template) => [
      template.existence.counter,
      template.fieldVersions.title.counter,
      template.fieldVersions.position.counter,
    ]),
    ...data.dailyOccurrences.flatMap((occurrence) => [
      occurrence.existence.counter,
      ...Object.values(occurrence.fieldVersions).map(
        (version) => version.counter,
      ),
    ]),
    ...data.entityTombstones.map(
      (tombstone) => tombstone.deleted.counter,
    ),
    ...data.attachmentTombstones.map(
      (tombstone) => tombstone.removed.counter,
    ),
    ...data.conflicts.flatMap((conflict) => [
      conflict.winner.counter,
      conflict.detected.counter,
    ]),
    ...data.conflictTombstones.map(
      (tombstone) => tombstone.dismissed.counter,
    ),
  );
}

function validatePosition(value: string, label: string): void {
  try {
    validatePositionKey(value);
  } catch {
    invalid(`${label} position key is invalid.`);
  }
}

function validateCompletion(
  completed: boolean,
  completedAt: number | null,
  label: string,
): void {
  if (
    (completed && completedAt === null) ||
    (!completed && completedAt !== null)
  ) {
    invalid(`${label} timestamp is inconsistent.`);
  }
}

function validateToday(
  today: boolean,
  todayAddedAt: number | null,
  label: string,
): void {
  if (
    (today && todayAddedAt === null) ||
    (!today && todayAddedAt !== null)
  ) {
    invalid(`${label} Today timestamp is inconsistent.`);
  }
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    invalid(`Duplicate ${label} ID.`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    invalid(`${label} must be a string.`);
  }
  return value;
}

function requiredTimestamp(value: unknown, label: string): number {
  if (!isTimestamp(value)) {
    invalid(`${label} must be a timestamp.`);
  }
  return value;
}

function isPriority(value: unknown): value is Priority {
  return typeof value === "string" && PRIORITIES.has(value as Priority);
}

function isTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function isCounter(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalid(message: string): never {
  throw new TaskDomainError("data-invalid", message);
}
