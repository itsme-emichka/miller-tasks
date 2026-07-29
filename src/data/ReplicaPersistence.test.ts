import { describe, expect, it } from "vitest";

import { TaskStore } from "../domain/TaskStore";
import { createDefaultPluginDataV3 } from "../sync/syncData";
import { parseReplicaDocumentText } from "../sync/replicaData";
import {
  getOrCreateReplicaId,
  ReplicaFileContents,
  ReplicaFileStore,
  ReplicaPersistence,
} from "./ReplicaPersistence";

describe("ReplicaPersistence", () => {
  it("keeps one stable local identity per vault key", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    let id = 0;
    const first = getOrCreateReplicaId(
      storage,
      "Tasks",
      () => `replica-${++id}`,
    );
    const repeated = getOrCreateReplicaId(
      storage,
      "Tasks",
      () => `replica-${++id}`,
    );
    const otherVault = getOrCreateReplicaId(
      storage,
      "Other",
      () => `replica-${++id}`,
    );

    expect(first).toBe("replica-1");
    expect(repeated).toBe(first);
    expect(otherVault).toBe("replica-2");
  });

  it("bootstraps once from legacy data and then ignores it", async () => {
    const files = new MemoryReplicaFiles();
    const legacyStore = createStore("mac", ["legacy-task"]);
    legacyStore.createTask({ title: "Preserved" });
    let legacyLoads = 0;
    const persistence = new ReplicaPersistence(
      "mac",
      files,
      async () => {
        legacyLoads += 1;
        return legacyStore.getSyncSnapshot();
      },
    );

    const first = await persistence.load();
    expect(first.state.tasks[0]?.title).toBe("Preserved");
    expect(legacyLoads).toBe(1);
    expect(files.writeCount).toBe(1);
    expect(
      parseReplicaDocumentText(
        files.contents.get(persistence.localPath)!,
      ).generation,
    ).toBe(1);

    const reloaded = new ReplicaPersistence(
      "mac",
      files,
      async () => {
        legacyLoads += 1;
        return createDefaultPluginDataV3();
      },
    );
    const second = await reloaded.load();
    expect(second.state.tasks[0]?.title).toBe("Preserved");
    expect(legacyLoads).toBe(1);
    expect(files.writeCount).toBe(1);
  });

  it("converges two installation-owned files without overwriting", async () => {
    const files = new MemoryReplicaFiles();
    const macLegacy = createStore("mac", ["mac-task"]);
    macLegacy.createTask({ title: "From Mac" });
    const macPersistence = new ReplicaPersistence(
      "mac",
      files,
      async () => macLegacy.getSyncSnapshot(),
    );
    const macLoaded = await macPersistence.load();
    const macStore = createStore(
      "mac",
      ["unused"],
      macLoaded.state,
      macPersistence,
    );

    const phonePersistence = new ReplicaPersistence(
      "phone",
      files,
      async () => null,
    );
    const phoneLoaded = await phonePersistence.load();
    const phoneStore = createStore(
      "phone",
      ["phone-task"],
      phoneLoaded.state,
      phonePersistence,
    );
    phoneStore.createTask({ title: "From phone" });
    await phoneStore.flush();

    const scan = await macPersistence.scan();
    const incoming = macPersistence.reconcile(
      macStore.getSyncSnapshot(),
      scan,
    );
    expect(incoming.materialChange).toBe(true);
    expect(macStore.replaceFromSync(incoming.state)).toBe(true);
    await macStore.flush();

    expect(
      macStore.getSnapshot().tasks.map((task) => task.title),
    ).toEqual(["From Mac", "From phone"]);
    expect(files.contents.has(macPersistence.localPath)).toBe(true);
    expect(files.contents.has(phonePersistence.localPath)).toBe(true);

    files.contents.delete(phonePersistence.localPath);
    const afterReplicaRemoval = macPersistence.reconcile(
      macStore.getSyncSnapshot(),
      await macPersistence.scan(),
    );
    expect(afterReplicaRemoval.materialChange).toBe(false);
    expect(
      afterReplicaRemoval.state.tasks.map((task) => task.title),
    ).toEqual(["From Mac", "From phone"]);
  });

  it("does not write for a state-identical replica rescan", async () => {
    const files = new MemoryReplicaFiles();
    const persistence = new ReplicaPersistence(
      "mac",
      files,
      async () => createDefaultPluginDataV3(),
    );
    const loaded = await persistence.load();
    const writesAfterLoad = files.writeCount;
    const result = persistence.reconcile(
      loaded.state,
      await persistence.scan(),
    );

    expect(result.materialChange).toBe(false);
    expect(result.blocked).toBe(false);
    expect(files.writeCount).toBe(writesAfterLoad);

    files.contents.delete(persistence.localPath);
    const missing = persistence.reconcile(
      loaded.state,
      await persistence.scan(),
    );
    expect(missing.materialChange).toBe(false);
    expect(missing.localWriteRequired).toBe(true);
  });

  it("quarantines invalid remote files but blocks an invalid local file", async () => {
    const files = new MemoryReplicaFiles();
    files.contents.set(
      "Miller Tasks/Sync/remote.json",
      "{partial",
    );
    const persistence = new ReplicaPersistence(
      "mac",
      files,
      async () => createDefaultPluginDataV3(),
    );
    const loaded = await persistence.load();
    expect(loaded.invalidPaths).toEqual([
      "Miller Tasks/Sync/remote.json",
    ]);
    expect(files.contents.has(persistence.localPath)).toBe(true);

    const validLocal = files.contents.get(persistence.localPath)!;
    files.contents.set(persistence.localPath, "{invalid");
    const runtimeBlocked = persistence.reconcile(
      loaded.state,
      await persistence.scan(),
    );
    expect(runtimeBlocked.blocked).toBe(true);
    await expect(persistence.save(loaded.state)).rejects.toThrow(
      /saving is paused/i,
    );

    const blocked = new ReplicaPersistence(
      "mac",
      files,
      async () => createDefaultPluginDataV3(),
    );
    await expect(blocked.load()).rejects.toThrow(
      /local Miller Tasks replica is invalid/i,
    );

    files.contents.set(persistence.localPath, validLocal);
    const recovered = persistence.reconcile(
      loaded.state,
      await persistence.scan(),
    );
    expect(recovered.blocked).toBe(false);
    expect(recovered.localWriteRequired).toBe(true);
    await expect(persistence.save(loaded.state)).resolves.toBeUndefined();
  });
});

class MemoryReplicaFiles implements ReplicaFileStore {
  readonly contents = new Map<string, string>();
  writeCount = 0;

  async list(): Promise<ReplicaFileContents[]> {
    return [...this.contents].map(([path, text]) => ({
      path,
      text,
    }));
  }

  async write(path: string, text: string): Promise<void> {
    this.writeCount += 1;
    this.contents.set(path, text);
  }
}

function createStore(
  actorId: string,
  ids: string[],
  data = createDefaultPluginDataV3(),
  persistence?: ReplicaPersistence,
): TaskStore {
  let index = 0;
  let now = 1_000;
  return new TaskStore(data, persistence, {
    actorId,
    idFactory: () => ids[index++]!,
    now: () => ++now,
  });
}
