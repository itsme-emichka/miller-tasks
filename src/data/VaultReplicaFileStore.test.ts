import { TFile, TFolder } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { VaultReplicaFileStore } from "./VaultReplicaFileStore";

describe("VaultReplicaFileStore", () => {
  it("creates the ordinary sync folders and updates one file", async () => {
    const files = new Map<string, { file: TFile; text: string }>();
    const folders = new Map<string, TFolder>();
    const vault = {
      getFiles: () => [...files.values()].map((entry) => entry.file),
      cachedRead: async (file: TFile) => files.get(file.path)!.text,
      getAbstractFileByPath: (path: string) =>
        files.get(path)?.file ?? folders.get(path) ?? null,
      createFolder: vi.fn(async (path: string) => {
        const folder = new TFolder();
        folder.path = path;
        folder.name = path.split("/").at(-1) ?? path;
        folders.set(path, folder);
        return folder;
      }),
      create: vi.fn(async (path: string, text: string) => {
        const file = new TFile();
        file.path = path;
        file.name = path.split("/").at(-1) ?? path;
        files.set(path, { file, text });
        return file;
      }),
      modify: vi.fn(async (file: TFile, text: string) => {
        files.set(file.path, { file, text });
      }),
    };
    const store = new VaultReplicaFileStore(vault as never);
    const path = "Miller Tasks/Sync/mac.json";

    await store.write(path, "first");
    await store.write(path, "second");

    expect(vault.createFolder.mock.calls.map(([folder]) => folder)).toEqual([
      "Miller Tasks",
      "Miller Tasks/Sync",
    ]);
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(vault.modify).toHaveBeenCalledTimes(1);
    expect(await store.list()).toEqual([{ path, text: "second" }]);
  });

  it("lists only direct JSON children of the sync folder", async () => {
    const paths = [
      "Miller Tasks/Sync/mac.json",
      "Miller Tasks/Sync/readme.md",
      "Miller Tasks/Sync/archive/old.json",
      "Elsewhere/phone.json",
    ];
    const files = paths.map((path) => {
      const file = new TFile();
      file.path = path;
      file.name = path.split("/").at(-1) ?? path;
      return file;
    });
    const vault = {
      getFiles: () => files,
      cachedRead: async (file: TFile) => file.path,
    };
    const store = new VaultReplicaFileStore(vault as never);

    expect(await store.list()).toEqual([
      {
        path: "Miller Tasks/Sync/mac.json",
        text: "Miller Tasks/Sync/mac.json",
      },
    ]);
  });
});
