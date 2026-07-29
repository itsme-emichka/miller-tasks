import type {
  TaskPersistenceWriter,
} from "./TaskPersistence";
import { TaskDomainError } from "../domain/task";
import { parseOrMigratePluginDataV3 } from "../sync/parseSyncData";
import {
  createReplicaDocument,
  isValidReplicaId,
  mergeReplicaDocuments,
  parseReplicaDocumentText,
  ReplicaDocument,
  replicaStateFingerprint,
  serializeReplicaDocument,
  VersionVector,
} from "../sync/replicaData";
import {
  clonePluginDataV3,
  PluginDataV3,
} from "../sync/syncData";

export const REPLICA_ROOT = "Miller Tasks/Sync";

export interface ReplicaFileContents {
  path: string;
  text: string;
}

export interface ReplicaFileStore {
  list(): Promise<ReplicaFileContents[]>;
  write(path: string, text: string): Promise<void>;
}

export interface ParsedReplicaFile {
  path: string;
  document: ReplicaDocument;
}

export interface ReplicaScan {
  files: ParsedReplicaFile[];
  invalidPaths: string[];
}

export interface ReplicaLoadResult {
  state: PluginDataV3;
  invalidPaths: string[];
}

export interface ReplicaReconcileResult {
  state: PluginDataV3;
  invalidPaths: string[];
  materialChange: boolean;
  blocked: boolean;
  localWriteRequired: boolean;
}

type LoadLegacyData = () => Promise<unknown>;

export class ReplicaPersistence implements TaskPersistenceWriter {
  private queue: Promise<void> = Promise.resolve();
  private latestSave: Promise<void> = Promise.resolve();
  private localGeneration = 0;
  private observed: VersionVector = {};
  private blocked = false;
  private requestedSave = 0;
  private completedSave = 0;

  constructor(
    readonly replicaId: string,
    private readonly files: ReplicaFileStore,
    private readonly loadLegacyData: LoadLegacyData,
  ) {
    if (!isValidReplicaId(replicaId)) {
      throw new TaskDomainError(
        "data-invalid",
        "Local replica ID is invalid.",
      );
    }
  }

  get localPath(): string {
    return `${REPLICA_ROOT}/${this.replicaId}.json`;
  }

  async load(): Promise<ReplicaLoadResult> {
    const scan = await this.scan();
    this.throwIfLocalReplicaIsInvalid(scan);
    const localFiles = scan.files.filter(
      (file) => file.document.replicaId === this.replicaId,
    );
    const localPrimary = localFiles.find(
      (file) => file.path === this.localPath,
    );
    const legacyState =
      localFiles.length === 0
        ? parseOrMigratePluginDataV3(await this.loadLegacyData())
        : undefined;
    const merged = mergeReplicaDocuments(
      scan.files.map((file) => file.document),
      legacyState,
    );

    this.observed = merged.observed;
    this.localGeneration = maximumLocalGeneration(
      scan.files,
      this.replicaId,
    );

    if (
      !localPrimary ||
      replicaStateFingerprint(localPrimary.document.state) !==
        replicaStateFingerprint(merged.state)
    ) {
      await this.save(merged.state);
      await this.flush();
    }

    return {
      state: clonePluginDataV3(merged.state),
      invalidPaths: scan.invalidPaths,
    };
  }

  async scan(): Promise<ReplicaScan> {
    const files = await this.files.list();
    const parsed: ParsedReplicaFile[] = [];
    const invalidPaths: string[] = [];

    for (const file of [...files].sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
    )) {
      try {
        parsed.push({
          path: file.path,
          document: parseReplicaDocumentText(file.text),
        });
      } catch {
        invalidPaths.push(file.path);
      }
    }

    return { files: parsed, invalidPaths };
  }

  reconcile(
    current: PluginDataV3,
    scan: ReplicaScan,
  ): ReplicaReconcileResult {
    if (scan.invalidPaths.includes(this.localPath)) {
      this.blocked = true;
      return {
        state: clonePluginDataV3(current),
        invalidPaths: [...scan.invalidPaths],
        materialChange: false,
        blocked: true,
        localWriteRequired: false,
      };
    }
    this.blocked = false;

    const merged = mergeReplicaDocuments(
      scan.files.map((file) => file.document),
      current,
      this.observed,
    );
    this.observed = merged.observed;
    this.localGeneration = Math.max(
      this.localGeneration,
      maximumLocalGeneration(scan.files, this.replicaId),
    );
    const materialChange =
      replicaStateFingerprint(current) !==
      replicaStateFingerprint(merged.state);

    return {
      state: clonePluginDataV3(merged.state),
      invalidPaths: [...scan.invalidPaths],
      materialChange,
      blocked: false,
      localWriteRequired: !scan.files.some(
        (file) => file.path === this.localPath,
      ) || this.completedSave < this.requestedSave,
    };
  }

  save(data: PluginDataV3): Promise<void> {
    const snapshot = clonePluginDataV3(data);
    const request = ++this.requestedSave;
    const save = this.queue.then(async () => {
      if (this.blocked) {
        throw new TaskDomainError(
          "data-invalid",
          "Replica saving is paused until the local file is valid.",
        );
      }
      const document = createReplicaDocument(
        this.replicaId,
        this.localGeneration + 1,
        this.observed,
        snapshot,
      );
      await this.files.write(
        this.localPath,
        serializeReplicaDocument(document),
      );
      this.localGeneration = document.generation;
      this.observed = document.observed;
      this.completedSave = Math.max(this.completedSave, request);
    });

    this.latestSave = save;
    this.queue = save.catch(() => undefined);
    return save;
  }

  async flush(): Promise<void> {
    await this.latestSave;
  }

  private throwIfLocalReplicaIsInvalid(scan: ReplicaScan): void {
    if (scan.invalidPaths.includes(this.localPath)) {
      throw new TaskDomainError(
        "data-invalid",
        "The local Miller Tasks replica is invalid.",
      );
    }
  }
}

export interface ReplicaIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function getOrCreateReplicaId(
  storage: ReplicaIdentityStorage,
  vaultName: string,
  idFactory: () => string = () => crypto.randomUUID(),
): string {
  const key =
    `miller-tasks:replica-id:${encodeURIComponent(vaultName)}`;
  const existing = storage.getItem(key);
  if (existing !== null && isValidReplicaId(existing)) {
    return existing;
  }

  const created = idFactory();
  if (!isValidReplicaId(created)) {
    throw new TaskDomainError(
      "data-invalid",
      "Generated replica ID is invalid.",
    );
  }
  storage.setItem(key, created);
  return created;
}

export function isReplicaPath(path: string): boolean {
  if (!path.startsWith(`${REPLICA_ROOT}/`) || !path.endsWith(".json")) {
    return false;
  }
  return !path.slice(REPLICA_ROOT.length + 1).includes("/");
}

function maximumLocalGeneration(
  files: readonly ParsedReplicaFile[],
  replicaId: string,
): number {
  return Math.max(
    0,
    ...files
      .filter((file) => file.document.replicaId === replicaId)
      .map((file) => file.document.generation),
  );
}
