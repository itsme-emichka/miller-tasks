import {
  normalizePath,
  TFile,
  TFolder,
  Vault,
} from "obsidian";

import {
  isReplicaPath,
  REPLICA_ROOT,
  ReplicaFileContents,
  ReplicaFileStore,
} from "./ReplicaPersistence";

export class VaultReplicaFileStore implements ReplicaFileStore {
  constructor(private readonly vault: Vault) {}

  async list(): Promise<ReplicaFileContents[]> {
    return Promise.all(
      this.vault
        .getFiles()
        .filter((file) => isReplicaPath(file.path))
        .map(async (file) => {
          try {
            return {
              path: file.path,
              text: await this.vault.cachedRead(file),
            };
          } catch {
            return { path: file.path, text: "" };
          }
        }),
    );
  }

  async write(path: string, text: string): Promise<void> {
    await this.ensureReplicaFolder();
    const normalizedPath = normalizePath(path);
    const existing = this.vault.getAbstractFileByPath(normalizedPath);
    if (existing instanceof TFile) {
      await this.vault.modify(existing, text);
      return;
    }
    if (existing !== null) {
      throw new Error(
        `A folder already exists at replica path ${normalizedPath}.`,
      );
    }
    await this.vault.create(normalizedPath, text);
  }

  private async ensureReplicaFolder(): Promise<void> {
    const segments = REPLICA_ROOT.split("/");
    let current = "";
    for (const segment of segments) {
      current = normalizePath(
        current === "" ? segment : `${current}/${segment}`,
      );
      const existing = this.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) {
        continue;
      }
      if (existing !== null) {
        throw new Error(
          `A file blocks the Miller Tasks folder ${current}.`,
        );
      }
      try {
        await this.vault.createFolder(current);
      } catch (error) {
        if (!(this.vault.getAbstractFileByPath(current) instanceof TFolder)) {
          throw error;
        }
      }
    }
  }
}
