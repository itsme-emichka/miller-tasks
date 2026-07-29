import { TaskDomainError } from "../domain/task";
import {
  mergePluginDataV3,
} from "./mergeSyncData";
import { parsePluginDataV3 } from "./parseSyncData";
import {
  canonicalizePluginDataV3,
  createDefaultPluginDataV3,
  PluginDataV3,
  VersionStamp,
} from "./syncData";

export const REPLICA_FORMAT = "miller-tasks-replica";
export const REPLICA_FORMAT_VERSION = 1;

export type VersionVector = Record<string, number>;

export interface ReplicaDocument {
  format: typeof REPLICA_FORMAT;
  formatVersion: typeof REPLICA_FORMAT_VERSION;
  replicaId: string;
  generation: number;
  observed: VersionVector;
  state: PluginDataV3;
}

export interface ReplicaMergeResult {
  state: PluginDataV3;
  observed: VersionVector;
  documents: ReplicaDocument[];
}

export function createReplicaDocument(
  replicaId: string,
  generation: number,
  observed: Readonly<VersionVector>,
  state: PluginDataV3,
): ReplicaDocument {
  validateReplicaId(replicaId);
  validateGeneration(generation);
  const parsedState = parsePluginDataV3(state);
  const canonicalObserved = mergeVersionVectors(
    observed,
    collectVersionVector(parsedState),
    { [replicaId]: 0 },
  );
  return {
    format: REPLICA_FORMAT,
    formatVersion: REPLICA_FORMAT_VERSION,
    replicaId,
    generation,
    observed: canonicalObserved,
    state: parsedState,
  };
}

export function parseReplicaDocument(
  value: unknown,
): ReplicaDocument {
  if (
    !isRecord(value) ||
    value.format !== REPLICA_FORMAT ||
    value.formatVersion !== REPLICA_FORMAT_VERSION ||
    typeof value.replicaId !== "string"
  ) {
    invalid("Replica envelope is invalid.");
  }
  validateReplicaId(value.replicaId);
  validateGeneration(value.generation);
  const observed = parseVersionVector(value.observed);
  const state = parsePluginDataV3(value.state);
  const required = collectVersionVector(state);
  for (const [actorId, counter] of Object.entries(required)) {
    if ((observed[actorId] ?? -1) < counter) {
      invalid(
        `Replica vector is behind state actor ${actorId}.`,
      );
    }
  }
  return createReplicaDocument(
    value.replicaId,
    value.generation,
    observed,
    state,
  );
}

export function parseReplicaDocumentText(
  text: string,
): ReplicaDocument {
  try {
    return parseReplicaDocument(JSON.parse(text) as unknown);
  } catch (error) {
    if (error instanceof TaskDomainError) {
      throw error;
    }
    invalid("Replica file is not valid JSON.");
  }
}

export function serializeReplicaDocument(
  document: ReplicaDocument,
): string {
  const canonical = createReplicaDocument(
    document.replicaId,
    document.generation,
    document.observed,
    document.state,
  );
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

export function collectVersionVector(
  data: PluginDataV3,
): VersionVector {
  const observed: VersionVector = {};
  const include = (version: VersionStamp): void => {
    observed[version.actorId] = Math.max(
      observed[version.actorId] ?? 0,
      version.counter,
    );
  };

  include(data.showCompletedVersion);
  for (const task of data.tasks) {
    include(task.existence);
    Object.values(task.fieldVersions).forEach(include);
    task.attachments.forEach((attachment) => {
      include(attachment.added);
    });
  }
  for (const template of data.dailyTemplates) {
    include(template.existence);
    include(template.fieldVersions.title);
    include(template.fieldVersions.position);
  }
  for (const occurrence of data.dailyOccurrences) {
    include(occurrence.existence);
    Object.values(occurrence.fieldVersions).forEach(include);
  }
  data.entityTombstones.forEach((tombstone) => {
    include(tombstone.deleted);
  });
  data.attachmentTombstones.forEach((tombstone) => {
    include(tombstone.removed);
  });
  data.conflicts.forEach((conflict) => {
    include(conflict.winner);
    include(conflict.detected);
  });
  data.conflictTombstones.forEach((tombstone) => {
    include(tombstone.dismissed);
  });

  return canonicalizeVersionVector(observed);
}

export function mergeVersionVectors(
  ...vectors: Readonly<VersionVector>[]
): VersionVector {
  const merged: VersionVector = {};
  for (const vector of vectors) {
    for (const [actorId, counter] of Object.entries(vector)) {
      if (!isCounter(counter) || actorId.trim() === "") {
        invalid("Version vector is invalid.");
      }
      merged[actorId] = Math.max(merged[actorId] ?? 0, counter);
    }
  }
  return canonicalizeVersionVector(merged);
}

export function mergeReplicaDocuments(
  documents: readonly ReplicaDocument[],
  initialState?: PluginDataV3,
): ReplicaMergeResult {
  const candidates = selectLatestReplicaDocuments(
    documents.map(parseReplicaDocument),
  );
  let state = initialState
    ? parsePluginDataV3(initialState)
    : createDefaultPluginDataV3();
  let observed = collectVersionVector(state);

  for (const document of candidates) {
    state = mergePluginDataV3(
      state,
      document.state,
      undefined,
      {
        leftObserved: observed,
        rightObserved: document.observed,
      },
    );
    observed = mergeVersionVectors(
      observed,
      document.observed,
      collectVersionVector(state),
    );
  }

  return {
    state: canonicalizePluginDataV3(state),
    observed,
    documents: candidates.map((document) =>
      createReplicaDocument(
        document.replicaId,
        document.generation,
        document.observed,
        document.state,
      ),
    ),
  };
}

export function replicaStateFingerprint(
  state: PluginDataV3,
): string {
  return JSON.stringify(canonicalizePluginDataV3(state));
}

function selectLatestReplicaDocuments(
  documents: readonly ReplicaDocument[],
): ReplicaDocument[] {
  const maximumGeneration = new Map<string, number>();
  for (const document of documents) {
    maximumGeneration.set(
      document.replicaId,
      Math.max(
        maximumGeneration.get(document.replicaId) ?? 0,
        document.generation,
      ),
    );
  }

  const unique = new Map<string, ReplicaDocument>();
  for (const document of documents) {
    if (
      document.generation !==
      maximumGeneration.get(document.replicaId)
    ) {
      continue;
    }
    unique.set(serializeReplicaDocument(document), document);
  }

  return [...unique.values()].sort((left, right) => {
    if (left.replicaId !== right.replicaId) {
      return left.replicaId < right.replicaId ? -1 : 1;
    }
    const leftSerialized = serializeReplicaDocument(left);
    const rightSerialized = serializeReplicaDocument(right);
    return leftSerialized < rightSerialized
      ? -1
      : leftSerialized > rightSerialized
        ? 1
        : 0;
  });
}

function parseVersionVector(value: unknown): VersionVector {
  if (!isRecord(value) || Array.isArray(value)) {
    invalid("Replica version vector is invalid.");
  }
  const observed: VersionVector = {};
  for (const [actorId, counter] of Object.entries(value)) {
    if (actorId.trim() === "" || !isCounter(counter)) {
      invalid("Replica version vector is invalid.");
    }
    observed[actorId] = counter;
  }
  return canonicalizeVersionVector(observed);
}

function canonicalizeVersionVector(
  vector: Readonly<VersionVector>,
): VersionVector {
  return Object.fromEntries(
    Object.entries(vector).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

function validateReplicaId(replicaId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(replicaId)) {
    invalid("Replica ID is invalid.");
  }
}

function validateGeneration(value: unknown): asserts value is number {
  if (!isCounter(value) || value < 1) {
    invalid("Replica generation is invalid.");
  }
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
