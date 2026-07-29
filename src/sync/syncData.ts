import { parsePluginData } from "../domain/pluginData";
import {
  DailyTaskTemplate,
  PluginData,
  Priority,
  TaskAttachment,
  TaskRecord,
} from "../domain/task";
import { createInitialPositionKey } from "./positionKey";

export const SYNC_SCHEMA_VERSION = 3;
export const MIGRATION_ACTOR_ID = "migration";

export interface VersionStamp {
  counter: number;
  actorId: string;
}

export const MIGRATION_VERSION: VersionStamp = {
  counter: 0,
  actorId: MIGRATION_ACTOR_ID,
};

export type TaskFieldGroup =
  | "title"
  | "description"
  | "tags"
  | "due"
  | "priority"
  | "flag"
  | "url"
  | "completion"
  | "today"
  | "structure";

export type EntityType =
  | "task"
  | "daily-template"
  | "daily-occurrence";

export type ConflictEntityType = EntityType | "plugin";

export type JsonValue =
  | boolean
  | number
  | string
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TaskFieldVersions = Record<
  TaskFieldGroup,
  VersionStamp
>;

export interface SyncedAttachment {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  createdAt: number;
  added: VersionStamp;
}

export interface SyncedTask {
  id: string;
  parentId: string | null;
  positionKey: string;
  title: string;
  completed: boolean;
  description: string;
  tags: string[];
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  flagged: boolean;
  url: string | null;
  attachments: SyncedAttachment[];
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  today: boolean;
  todayAddedAt: number | null;
  existence: VersionStamp;
  fieldVersions: TaskFieldVersions;
}

export interface DailyTemplateFieldVersions {
  title: VersionStamp;
  position: VersionStamp;
}

export interface SyncedDailyTemplate {
  id: string;
  title: string;
  positionKey: string;
  createdAt: number;
  updatedAt: number;
  existence: VersionStamp;
  fieldVersions: DailyTemplateFieldVersions;
}

export type DailyOccurrenceFieldGroup =
  | "description"
  | "tags"
  | "due"
  | "priority"
  | "flag"
  | "url"
  | "completion";

export type DailyOccurrenceFieldVersions = Record<
  DailyOccurrenceFieldGroup,
  VersionStamp
>;

export interface SyncedDailyOccurrence {
  id: string;
  templateId: string;
  date: string;
  completed: boolean;
  description: string;
  tags: string[];
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  flagged: boolean;
  url: string | null;
  completedAt: number | null;
  createdAt: number;
  updatedAt: number;
  todayAddedAt: number;
  existence: VersionStamp;
  fieldVersions: DailyOccurrenceFieldVersions;
}

export interface EntityTombstone {
  entityType: EntityType;
  id: string;
  deleted: VersionStamp;
  deletedAt: number;
}

export interface AttachmentTombstone {
  taskId: string;
  attachmentId: string;
  removed: VersionStamp;
  removedAt: number;
}

export interface SyncConflict {
  id: string;
  entityType: ConflictEntityType;
  entityId: string;
  fieldGroup: string;
  leftValue: JsonValue;
  rightValue: JsonValue;
  winner: VersionStamp;
  detected: VersionStamp;
}

export interface ConflictTombstone {
  id: string;
  dismissed: VersionStamp;
  dismissedAt: number;
}

export interface PluginDataV3 {
  schemaVersion: typeof SYNC_SCHEMA_VERSION;
  clock: number;
  showCompleted: boolean;
  showCompletedVersion: VersionStamp;
  tasks: SyncedTask[];
  dailyTemplates: SyncedDailyTemplate[];
  dailyOccurrences: SyncedDailyOccurrence[];
  entityTombstones: EntityTombstone[];
  attachmentTombstones: AttachmentTombstone[];
  conflicts: SyncConflict[];
  conflictTombstones: ConflictTombstone[];
}

export function createDefaultPluginDataV3(): PluginDataV3 {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    clock: 0,
    showCompleted: false,
    showCompletedVersion: cloneVersion(MIGRATION_VERSION),
    tasks: [],
    dailyTemplates: [],
    dailyOccurrences: [],
    entityTombstones: [],
    attachmentTombstones: [],
    conflicts: [],
    conflictTombstones: [],
  };
}

export function migratePluginDataToV3(value: unknown): PluginDataV3 {
  return migratePluginDataV2ToV3(parsePluginData(value));
}

export function migratePluginDataV2ToV3(
  data: PluginData,
): PluginDataV3 {
  const tasks = data.tasks
    .filter((task) => task.dailyTemplateId === null)
    .map(migrateTask);
  const dailyOccurrences = data.tasks
    .filter(
      (
        task,
      ): task is TaskRecord & {
        dailyTemplateId: string;
        generatedForDate: string;
      } =>
        task.dailyTemplateId !== null &&
        task.generatedForDate !== null,
    )
    .map(migrateDailyOccurrence);

  return canonicalizePluginDataV3({
    ...createDefaultPluginDataV3(),
    showCompleted: data.showCompleted,
    tasks,
    dailyTemplates: data.dailyTemplates.map(migrateDailyTemplate),
    dailyOccurrences,
  });
}

export function createDailyOccurrenceId(
  templateId: string,
  date: string,
): string {
  return `${templateId}:${date}`;
}

export function createMigrationPositionKey(order: number): string {
  return createInitialPositionKey(order);
}

export function canonicalizePluginDataV3(
  data: PluginDataV3,
): PluginDataV3 {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    clock: data.clock,
    showCompleted: data.showCompleted,
    showCompletedVersion: cloneVersion(data.showCompletedVersion),
    tasks: data.tasks
      .map(cloneSyncedTask)
      .sort(compareIds),
    dailyTemplates: data.dailyTemplates
      .map(cloneDailyTemplate)
      .sort(compareIds),
    dailyOccurrences: data.dailyOccurrences
      .map(cloneDailyOccurrence)
      .sort(compareIds),
    entityTombstones: data.entityTombstones
      .map(cloneEntityTombstone)
      .sort((left, right) =>
        compareStrings(
          `${left.entityType}:${left.id}`,
          `${right.entityType}:${right.id}`,
        ),
      ),
    attachmentTombstones: data.attachmentTombstones
      .map(cloneAttachmentTombstone)
      .sort((left, right) =>
        compareStrings(
          `${left.taskId}:${left.attachmentId}`,
          `${right.taskId}:${right.attachmentId}`,
        ),
      ),
    conflicts: data.conflicts
      .map(cloneSyncConflict)
      .sort(compareIds),
    conflictTombstones: data.conflictTombstones
      .map(cloneConflictTombstone)
      .sort(compareIds),
  };
}

export function serializePluginDataV3(data: PluginDataV3): string {
  return `${JSON.stringify(canonicalizePluginDataV3(data), null, 2)}\n`;
}

export function clonePluginDataV3(
  data: PluginDataV3,
): PluginDataV3 {
  return canonicalizePluginDataV3(data);
}

export function compareVersions(
  left: VersionStamp,
  right: VersionStamp,
): number {
  if (left.counter !== right.counter) {
    return left.counter - right.counter;
  }
  return compareStrings(left.actorId, right.actorId);
}

export function cloneVersion(
  version: VersionStamp,
): VersionStamp {
  return { ...version };
}

export function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([key, child]) => [key, cloneJsonValue(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(cloneJsonValue(value));
}

function migrateTask(task: TaskRecord): SyncedTask {
  return {
    id: task.id,
    parentId: task.parentId,
    positionKey: createMigrationPositionKey(task.order),
    title: task.title,
    completed: task.completed,
    description: task.description,
    tags: [...task.tags],
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    flagged: task.flagged,
    url: task.url,
    attachments: task.attachments.map(migrateAttachment),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    today: task.today,
    todayAddedAt: task.todayAddedAt,
    existence: cloneVersion(MIGRATION_VERSION),
    fieldVersions: createMigrationTaskFieldVersions(),
  };
}

function migrateAttachment(
  attachment: TaskAttachment,
): SyncedAttachment {
  return {
    ...attachment,
    added: cloneVersion(MIGRATION_VERSION),
  };
}

function migrateDailyTemplate(
  template: DailyTaskTemplate,
): SyncedDailyTemplate {
  return {
    id: template.id,
    title: template.title,
    positionKey: createMigrationPositionKey(template.order),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
    existence: cloneVersion(MIGRATION_VERSION),
    fieldVersions: {
      title: cloneVersion(MIGRATION_VERSION),
      position: cloneVersion(MIGRATION_VERSION),
    },
  };
}

function migrateDailyOccurrence(
  task: TaskRecord & {
    dailyTemplateId: string;
    generatedForDate: string;
  },
): SyncedDailyOccurrence {
  return {
    id: createDailyOccurrenceId(
      task.dailyTemplateId,
      task.generatedForDate,
    ),
    templateId: task.dailyTemplateId,
    date: task.generatedForDate,
    completed: task.completed,
    description: task.description,
    tags: [...task.tags],
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    flagged: task.flagged,
    url: task.url,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    todayAddedAt: task.todayAddedAt ?? task.createdAt,
    existence: cloneVersion(MIGRATION_VERSION),
    fieldVersions: createMigrationOccurrenceFieldVersions(),
  };
}

function createMigrationTaskFieldVersions(): TaskFieldVersions {
  return {
    title: cloneVersion(MIGRATION_VERSION),
    description: cloneVersion(MIGRATION_VERSION),
    tags: cloneVersion(MIGRATION_VERSION),
    due: cloneVersion(MIGRATION_VERSION),
    priority: cloneVersion(MIGRATION_VERSION),
    flag: cloneVersion(MIGRATION_VERSION),
    url: cloneVersion(MIGRATION_VERSION),
    completion: cloneVersion(MIGRATION_VERSION),
    today: cloneVersion(MIGRATION_VERSION),
    structure: cloneVersion(MIGRATION_VERSION),
  };
}

function createMigrationOccurrenceFieldVersions(): DailyOccurrenceFieldVersions {
  return {
    description: cloneVersion(MIGRATION_VERSION),
    tags: cloneVersion(MIGRATION_VERSION),
    due: cloneVersion(MIGRATION_VERSION),
    priority: cloneVersion(MIGRATION_VERSION),
    flag: cloneVersion(MIGRATION_VERSION),
    url: cloneVersion(MIGRATION_VERSION),
    completion: cloneVersion(MIGRATION_VERSION),
  };
}

function cloneSyncedTask(task: SyncedTask): SyncedTask {
  return {
    ...task,
    tags: [...task.tags],
    attachments: task.attachments
      .map((attachment) => ({
        ...attachment,
        added: cloneVersion(attachment.added),
      }))
      .sort(compareIds),
    existence: cloneVersion(task.existence),
    fieldVersions: Object.fromEntries(
      Object.entries(task.fieldVersions).map(([group, version]) => [
        group,
        cloneVersion(version),
      ]),
    ) as TaskFieldVersions,
  };
}

function cloneDailyTemplate(
  template: SyncedDailyTemplate,
): SyncedDailyTemplate {
  return {
    ...template,
    existence: cloneVersion(template.existence),
    fieldVersions: {
      title: cloneVersion(template.fieldVersions.title),
      position: cloneVersion(template.fieldVersions.position),
    },
  };
}

function cloneDailyOccurrence(
  occurrence: SyncedDailyOccurrence,
): SyncedDailyOccurrence {
  return {
    ...occurrence,
    tags: [...occurrence.tags],
    existence: cloneVersion(occurrence.existence),
    fieldVersions: Object.fromEntries(
      Object.entries(occurrence.fieldVersions).map(
        ([group, version]) => [group, cloneVersion(version)],
      ),
    ) as DailyOccurrenceFieldVersions,
  };
}

function cloneEntityTombstone(
  tombstone: EntityTombstone,
): EntityTombstone {
  return {
    ...tombstone,
    deleted: cloneVersion(tombstone.deleted),
  };
}

function cloneAttachmentTombstone(
  tombstone: AttachmentTombstone,
): AttachmentTombstone {
  return {
    ...tombstone,
    removed: cloneVersion(tombstone.removed),
  };
}

function cloneSyncConflict(
  conflict: SyncConflict,
): SyncConflict {
  return {
    ...conflict,
    leftValue: cloneJsonValue(conflict.leftValue),
    rightValue: cloneJsonValue(conflict.rightValue),
    winner: cloneVersion(conflict.winner),
    detected: cloneVersion(conflict.detected),
  };
}

function cloneConflictTombstone(
  tombstone: ConflictTombstone,
): ConflictTombstone {
  return {
    ...tombstone,
    dismissed: cloneVersion(tombstone.dismissed),
  };
}

function compareIds(
  left: { id: string },
  right: { id: string },
): number {
  return compareStrings(left.id, right.id);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
