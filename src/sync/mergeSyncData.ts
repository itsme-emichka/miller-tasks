import {
  canonicalJson,
  canonicalizePluginDataV3,
  cloneJsonValue,
  cloneVersion,
  compareVersions,
  ConflictEntityType,
  DailyOccurrenceFieldGroup,
  EntityType,
  JsonValue,
  PluginDataV3,
  SyncConflict,
  SyncedAttachment,
  SyncedDailyOccurrence,
  SyncedDailyTemplate,
  SyncedTask,
  TaskFieldGroup,
  VersionStamp,
} from "./syncData";

interface Register<T> {
  value: T;
  version: VersionStamp;
}

interface ConflictLocation {
  entityType: ConflictEntityType;
  entityId: string;
  fieldGroup: string;
}

interface MergeContext {
  conflicts: Map<string, SyncConflict>;
}

export function mergePluginDataV3(
  left: PluginDataV3,
  right: PluginDataV3,
  base?: PluginDataV3,
): PluginDataV3 {
  const context: MergeContext = {
    conflicts: mergeConflictMaps(left.conflicts, right.conflicts),
  };
  const showCompleted = mergeRegister(
    {
      value: left.showCompleted,
      version: left.showCompletedVersion,
    },
    {
      value: right.showCompleted,
      version: right.showCompletedVersion,
    },
    base
      ? {
          value: base.showCompleted,
          version: base.showCompletedVersion,
        }
      : undefined,
    {
      entityType: "plugin",
      entityId: "miller-tasks",
      fieldGroup: "showCompleted",
    },
    context,
  );
  const merged: PluginDataV3 = {
    schemaVersion: 3,
    clock: Math.max(left.clock, right.clock, base?.clock ?? 0),
    showCompleted: showCompleted.value,
    showCompletedVersion: showCompleted.version,
    tasks: mergeEntities(
      left.tasks,
      right.tasks,
      base?.tasks,
      mergeTask,
      context,
    ),
    dailyTemplates: mergeEntities(
      left.dailyTemplates,
      right.dailyTemplates,
      base?.dailyTemplates,
      mergeDailyTemplate,
      context,
    ),
    dailyOccurrences: mergeEntities(
      left.dailyOccurrences,
      right.dailyOccurrences,
      base?.dailyOccurrences,
      mergeDailyOccurrence,
      context,
    ),
    entityTombstones: mergeLatestRecords(
      left.entityTombstones,
      right.entityTombstones,
      (tombstone) => `${tombstone.entityType}:${tombstone.id}`,
      (tombstone) => tombstone.deleted,
    ),
    attachmentTombstones: mergeLatestRecords(
      left.attachmentTombstones,
      right.attachmentTombstones,
      (tombstone) =>
        `${tombstone.taskId}:${tombstone.attachmentId}`,
      (tombstone) => tombstone.removed,
    ),
    conflicts: [],
    conflictTombstones: mergeLatestRecords(
      left.conflictTombstones,
      right.conflictTombstones,
      (tombstone) => tombstone.id,
      (tombstone) => tombstone.dismissed,
    ),
  };

  merged.conflicts = [...context.conflicts.values()];
  merged.clock = Math.max(
    merged.clock,
    getMaximumVersionCounter(merged),
  );
  return canonicalizePluginDataV3(merged);
}

export function isEntityPresent(
  data: PluginDataV3,
  entityType: EntityType,
  id: string,
): boolean {
  const entity =
    entityType === "task"
      ? data.tasks.find((candidate) => candidate.id === id)
      : entityType === "daily-template"
        ? data.dailyTemplates.find(
            (candidate) => candidate.id === id,
          )
        : data.dailyOccurrences.find(
            (candidate) => candidate.id === id,
          );
  if (!entity) {
    return false;
  }
  const tombstone = data.entityTombstones.find(
    (candidate) =>
      candidate.entityType === entityType && candidate.id === id,
  );
  return (
    !tombstone ||
    compareVersions(entity.existence, tombstone.deleted) > 0
  );
}

export function isAttachmentPresent(
  data: PluginDataV3,
  taskId: string,
  attachmentId: string,
): boolean {
  if (!isEntityPresent(data, "task", taskId)) {
    return false;
  }
  const attachment = data.tasks
    .find((task) => task.id === taskId)
    ?.attachments.find((candidate) => candidate.id === attachmentId);
  if (!attachment) {
    return false;
  }
  const tombstone = data.attachmentTombstones.find(
    (candidate) =>
      candidate.taskId === taskId &&
      candidate.attachmentId === attachmentId,
  );
  return (
    !tombstone ||
    compareVersions(attachment.added, tombstone.removed) > 0
  );
}

export function getActiveSyncConflicts(
  data: PluginDataV3,
): SyncConflict[] {
  const dismissals = new Map(
    data.conflictTombstones.map((tombstone) => [
      tombstone.id,
      tombstone,
    ]),
  );
  return data.conflicts.filter((conflict) => {
    const dismissal = dismissals.get(conflict.id);
    return (
      !dismissal ||
      compareVersions(conflict.detected, dismissal.dismissed) > 0
    );
  });
}

function mergeTask(
  left: SyncedTask,
  right: SyncedTask,
  base: SyncedTask | undefined,
  context: MergeContext,
): SyncedTask {
  const title = mergeTaskField(
    "title",
    left,
    right,
    base,
    (task) => task.title,
    context,
  );
  const description = mergeTaskField(
    "description",
    left,
    right,
    base,
    (task) => task.description,
    context,
  );
  const tags = mergeTaskField(
    "tags",
    left,
    right,
    base,
    (task) => task.tags,
    context,
  );
  const due = mergeTaskField(
    "due",
    left,
    right,
    base,
    (task) => ({
      dueDate: task.dueDate,
      dueTime: task.dueTime,
    }),
    context,
  );
  const priority = mergeTaskField(
    "priority",
    left,
    right,
    base,
    (task) => task.priority,
    context,
  );
  const flag = mergeTaskField(
    "flag",
    left,
    right,
    base,
    (task) => task.flagged,
    context,
  );
  const url = mergeTaskField(
    "url",
    left,
    right,
    base,
    (task) => task.url,
    context,
  );
  const completion = mergeTaskField(
    "completion",
    left,
    right,
    base,
    (task) => ({
      completed: task.completed,
      completedAt: task.completedAt,
    }),
    context,
  );
  const today = mergeTaskField(
    "today",
    left,
    right,
    base,
    (task) => ({
      today: task.today,
      todayAddedAt: task.todayAddedAt,
    }),
    context,
  );
  const structure = mergeTaskField(
    "structure",
    left,
    right,
    base,
    (task) => ({
      parentId: task.parentId,
      positionKey: task.positionKey,
    }),
    context,
  );

  return {
    id: left.id,
    parentId: structure.value.parentId,
    positionKey: structure.value.positionKey,
    title: title.value,
    completed: completion.value.completed,
    description: description.value,
    tags: [...tags.value],
    dueDate: due.value.dueDate,
    dueTime: due.value.dueTime,
    priority: priority.value,
    flagged: flag.value,
    url: url.value,
    attachments: mergeAttachments(
      left,
      right,
      base,
      context,
    ),
    createdAt: Math.min(left.createdAt, right.createdAt),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    completedAt: completion.value.completedAt,
    today: today.value.today,
    todayAddedAt: today.value.todayAddedAt,
    existence: maximumVersion(left.existence, right.existence),
    fieldVersions: {
      title: title.version,
      description: description.version,
      tags: tags.version,
      due: due.version,
      priority: priority.version,
      flag: flag.version,
      url: url.version,
      completion: completion.version,
      today: today.version,
      structure: structure.version,
    },
  };
}

function mergeTaskField<T>(
  group: TaskFieldGroup,
  left: SyncedTask,
  right: SyncedTask,
  base: SyncedTask | undefined,
  getValue: (task: SyncedTask) => T,
  context: MergeContext,
): Register<T> {
  return mergeRegister(
    {
      value: getValue(left),
      version: left.fieldVersions[group],
    },
    {
      value: getValue(right),
      version: right.fieldVersions[group],
    },
    base
      ? {
          value: getValue(base),
          version: base.fieldVersions[group],
        }
      : undefined,
    {
      entityType: "task",
      entityId: left.id,
      fieldGroup: group,
    },
    context,
  );
}

function mergeAttachments(
  left: SyncedTask,
  right: SyncedTask,
  base: SyncedTask | undefined,
  context: MergeContext,
): SyncedAttachment[] {
  return mergeEntities(
    left.attachments,
    right.attachments,
    base?.attachments,
    (leftAttachment, rightAttachment, baseAttachment) => {
      const attachment = mergeRegister(
        attachmentRegister(leftAttachment),
        attachmentRegister(rightAttachment),
        baseAttachment
          ? attachmentRegister(baseAttachment)
          : undefined,
        {
          entityType: "task",
          entityId: left.id,
          fieldGroup: `attachment:${leftAttachment.id}`,
        },
        context,
      );
      return {
        ...attachment.value,
        added: attachment.version,
      };
    },
    context,
  );
}

function attachmentRegister(
  attachment: SyncedAttachment,
): Register<Omit<SyncedAttachment, "added">> {
  const { added, ...value } = attachment;
  return { value, version: added };
}

function mergeDailyTemplate(
  left: SyncedDailyTemplate,
  right: SyncedDailyTemplate,
  base: SyncedDailyTemplate | undefined,
  context: MergeContext,
): SyncedDailyTemplate {
  const title = mergeRegister(
    {
      value: left.title,
      version: left.fieldVersions.title,
    },
    {
      value: right.title,
      version: right.fieldVersions.title,
    },
    base
      ? {
          value: base.title,
          version: base.fieldVersions.title,
        }
      : undefined,
    {
      entityType: "daily-template",
      entityId: left.id,
      fieldGroup: "title",
    },
    context,
  );
  const position = mergeRegister(
    {
      value: left.positionKey,
      version: left.fieldVersions.position,
    },
    {
      value: right.positionKey,
      version: right.fieldVersions.position,
    },
    base
      ? {
          value: base.positionKey,
          version: base.fieldVersions.position,
        }
      : undefined,
    {
      entityType: "daily-template",
      entityId: left.id,
      fieldGroup: "position",
    },
    context,
  );

  return {
    id: left.id,
    title: title.value,
    positionKey: position.value,
    createdAt: Math.min(left.createdAt, right.createdAt),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    existence: maximumVersion(left.existence, right.existence),
    fieldVersions: {
      title: title.version,
      position: position.version,
    },
  };
}

function mergeDailyOccurrence(
  left: SyncedDailyOccurrence,
  right: SyncedDailyOccurrence,
  base: SyncedDailyOccurrence | undefined,
  context: MergeContext,
): SyncedDailyOccurrence {
  const description = mergeOccurrenceField(
    "description",
    left,
    right,
    base,
    (occurrence) => occurrence.description,
    context,
  );
  const tags = mergeOccurrenceField(
    "tags",
    left,
    right,
    base,
    (occurrence) => occurrence.tags,
    context,
  );
  const due = mergeOccurrenceField(
    "due",
    left,
    right,
    base,
    (occurrence) => ({
      dueDate: occurrence.dueDate,
      dueTime: occurrence.dueTime,
    }),
    context,
  );
  const priority = mergeOccurrenceField(
    "priority",
    left,
    right,
    base,
    (occurrence) => occurrence.priority,
    context,
  );
  const flag = mergeOccurrenceField(
    "flag",
    left,
    right,
    base,
    (occurrence) => occurrence.flagged,
    context,
  );
  const url = mergeOccurrenceField(
    "url",
    left,
    right,
    base,
    (occurrence) => occurrence.url,
    context,
  );
  const completion = mergeOccurrenceField(
    "completion",
    left,
    right,
    base,
    (occurrence) => ({
      completed: occurrence.completed,
      completedAt: occurrence.completedAt,
    }),
    context,
  );

  return {
    id: left.id,
    templateId: chooseImmutableString(
      left.templateId,
      right.templateId,
    ),
    date: chooseImmutableString(left.date, right.date),
    completed: completion.value.completed,
    description: description.value,
    tags: [...tags.value],
    dueDate: due.value.dueDate,
    dueTime: due.value.dueTime,
    priority: priority.value,
    flagged: flag.value,
    url: url.value,
    completedAt: completion.value.completedAt,
    createdAt: Math.min(left.createdAt, right.createdAt),
    updatedAt: Math.max(left.updatedAt, right.updatedAt),
    todayAddedAt: Math.min(left.todayAddedAt, right.todayAddedAt),
    existence: maximumVersion(left.existence, right.existence),
    fieldVersions: {
      description: description.version,
      tags: tags.version,
      due: due.version,
      priority: priority.version,
      flag: flag.version,
      url: url.version,
      completion: completion.version,
    },
  };
}

function mergeOccurrenceField<T>(
  group: DailyOccurrenceFieldGroup,
  left: SyncedDailyOccurrence,
  right: SyncedDailyOccurrence,
  base: SyncedDailyOccurrence | undefined,
  getValue: (occurrence: SyncedDailyOccurrence) => T,
  context: MergeContext,
): Register<T> {
  return mergeRegister(
    {
      value: getValue(left),
      version: left.fieldVersions[group],
    },
    {
      value: getValue(right),
      version: right.fieldVersions[group],
    },
    base
      ? {
          value: getValue(base),
          version: base.fieldVersions[group],
        }
      : undefined,
    {
      entityType: "daily-occurrence",
      entityId: left.id,
      fieldGroup: group,
    },
    context,
  );
}

function mergeRegister<T>(
  left: Register<T>,
  right: Register<T>,
  base: Register<T> | undefined,
  location: ConflictLocation,
  context: MergeContext,
): Register<T> {
  const leftJson = toJsonValue(left.value);
  const rightJson = toJsonValue(right.value);
  const valuesEqual = canonicalJson(leftJson) === canonicalJson(rightJson);
  const comparison = compareRegisters(left, right);
  const winner = comparison >= 0 ? left : right;

  if (
    !valuesEqual &&
    (compareVersions(left.version, right.version) === 0 ||
      (base !== undefined &&
        !registersEqual(left, base) &&
        !registersEqual(right, base)))
  ) {
    const conflict = createConflict(
      left,
      right,
      location,
      winner.version,
    );
    context.conflicts.set(conflict.id, conflict);
  }

  return {
    value: cloneRegisterValue(winner.value),
    version: cloneVersion(winner.version),
  };
}

function mergeEntities<T extends { id: string }>(
  left: readonly T[],
  right: readonly T[],
  base: readonly T[] | undefined,
  merge: (
    left: T,
    right: T,
    base: T | undefined,
    context: MergeContext,
  ) => T,
  context: MergeContext,
): T[] {
  const leftById = new Map(left.map((entity) => [entity.id, entity]));
  const rightById = new Map(
    right.map((entity) => [entity.id, entity]),
  );
  const baseById = new Map(
    (base ?? []).map((entity) => [entity.id, entity]),
  );
  const ids = new Set([...leftById.keys(), ...rightById.keys()]);
  const result: T[] = [];

  for (const id of ids) {
    const leftEntity = leftById.get(id);
    const rightEntity = rightById.get(id);
    if (leftEntity && rightEntity) {
      result.push(
        merge(leftEntity, rightEntity, baseById.get(id), context),
      );
    } else {
      result.push((leftEntity ?? rightEntity)!);
    }
  }
  return result;
}

function mergeLatestRecords<T>(
  left: readonly T[],
  right: readonly T[],
  getKey: (record: T) => string,
  getVersion: (record: T) => VersionStamp,
): T[] {
  const result = new Map<string, T>();
  for (const record of [...left, ...right]) {
    const key = getKey(record);
    const current = result.get(key);
    if (
      !current ||
      compareVersionedRecords(record, current, getVersion) > 0
    ) {
      result.set(key, record);
    }
  }
  return [...result.values()];
}

function compareVersionedRecords<T>(
  left: T,
  right: T,
  getVersion: (record: T) => VersionStamp,
): number {
  const versionComparison = compareVersions(
    getVersion(left),
    getVersion(right),
  );
  if (versionComparison !== 0) {
    return versionComparison;
  }
  return compareCanonicalValues(left, right);
}

function mergeConflictMaps(
  left: readonly SyncConflict[],
  right: readonly SyncConflict[],
): Map<string, SyncConflict> {
  return new Map(
    mergeLatestRecords(
      left,
      right,
      (conflict) => conflict.id,
      (conflict) => conflict.detected,
    ).map((conflict) => [conflict.id, conflict]),
  );
}

function createConflict<T>(
  left: Register<T>,
  right: Register<T>,
  location: ConflictLocation,
  winner: VersionStamp,
): SyncConflict {
  const candidates = [left, right].sort(compareRegisters);
  const leftValue = toJsonValue(candidates[0]!.value);
  const rightValue = toJsonValue(candidates[1]!.value);
  const fingerprint = [
    versionToken(candidates[0]!.version),
    canonicalJson(leftValue),
    versionToken(candidates[1]!.version),
    canonicalJson(rightValue),
  ].join("|");
  const detected = maximumVersion(left.version, right.version);

  return {
    id: [
      location.entityType,
      location.entityId,
      location.fieldGroup,
      hashString(fingerprint),
    ].join(":"),
    entityType: location.entityType,
    entityId: location.entityId,
    fieldGroup: location.fieldGroup,
    leftValue,
    rightValue,
    winner: cloneVersion(winner),
    detected,
  };
}

function compareRegisters<T>(
  left: Register<T>,
  right: Register<T>,
): number {
  const versionComparison = compareVersions(
    left.version,
    right.version,
  );
  if (versionComparison !== 0) {
    return versionComparison;
  }
  return compareCanonicalValues(left.value, right.value);
}

function registersEqual<T>(
  left: Register<T>,
  right: Register<T>,
): boolean {
  return (
    compareVersions(left.version, right.version) === 0 &&
    compareCanonicalValues(left.value, right.value) === 0
  );
}

function compareCanonicalValues(left: unknown, right: unknown): number {
  const leftJson = canonicalJson(toJsonValue(left));
  const rightJson = canonicalJson(toJsonValue(right));
  return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
}

function maximumVersion(
  left: VersionStamp,
  right: VersionStamp,
): VersionStamp {
  return cloneVersion(
    compareVersions(left, right) >= 0 ? left : right,
  );
}

function chooseImmutableString(left: string, right: string): string {
  return left < right ? left : right;
}

function cloneRegisterValue<T>(value: T): T {
  return cloneJsonValue(toJsonValue(value)) as T;
}

function toJsonValue(value: unknown): JsonValue {
  return value as JsonValue;
}

function versionToken(version: VersionStamp): string {
  return `${version.counter}@${version.actorId}`;
}

function hashString(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getMaximumVersionCounter(data: PluginDataV3): number {
  const counters: number[] = [
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
  ];
  return Math.max(0, ...counters);
}
