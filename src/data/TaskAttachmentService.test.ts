import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import { TaskAttachmentService } from "./TaskAttachmentService";

function createHarness(): {
  service: TaskAttachmentService;
  store: TaskStore;
  files: Map<string, TFile>;
  trashFile: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
} {
  const store = new TaskStore(createDefaultPluginData());
  const files = new Map<string, TFile>();
  const folders = new Set<string>();
  const trashFile = vi.fn(async (file: TFile) => {
    files.delete((file as unknown as { path: string }).path);
  });
  const openFile = vi.fn(async () => undefined);
  const vault = {
    getAbstractFileByPath: (path: string) =>
      files.get(path) ?? (folders.has(path) ? { path } : null),
    createFolder: vi.fn(async (path: string) => {
      folders.add(path);
    }),
    createBinary: vi.fn(async (path: string) => {
      const file = new TFile();
      file.path = path;
      file.name = path.split("/").at(-1) ?? path;
      files.set(path, file);
      return file;
    }),
    getResourcePath: (file: TFile) =>
      `app://vault/${(file as unknown as { path: string }).path}`,
  };
  const app = {
    vault,
    fileManager: { trashFile },
    workspace: {
      getLeaf: () => ({ openFile }),
    },
  };
  let id = 0;
  const service = new TaskAttachmentService(
    app as never,
    store,
    {
      idFactory: () => `image-${++id}`,
      now: () => 123,
    },
  );
  return { service, store, files, trashFile, openFile };
}

function imageFile(name: string): File {
  return {
    name,
    type: "image/png",
    arrayBuffer: async () => new ArrayBuffer(4),
  } as File;
}

describe("TaskAttachmentService", () => {
  it("copies multiple images into the task folder and opens previews", async () => {
    const { service, store, files, openFile } = createHarness();
    const task = store.createTask({ id: "task-1", title: "Images" });

    const result = await service.addFiles(task.id, [
      imageFile("first.png"),
      imageFile("second.png"),
      {
        ...imageFile("notes.txt"),
        type: "text/plain",
      },
    ]);

    expect(result.attachments).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(store.getTask(task.id)?.attachments).toHaveLength(2);
    expect([...files.keys()]).toEqual([
      "Miller Tasks/Attachments/task-1/image-1-first.png",
      "Miller Tasks/Attachments/task-1/image-2-second.png",
    ]);

    const attachment = result.attachments[0]!;
    expect(service.getResourceUrl(attachment)).toContain(attachment.path);
    await service.openAttachment(attachment);
    expect(openFile).toHaveBeenCalledTimes(1);
  });

  it("keeps the attachment record when trashing fails", async () => {
    const { service, store, trashFile } = createHarness();
    const task = store.createTask({ id: "task-1", title: "Images" });
    const result = await service.addFiles(task.id, [
      imageFile("first.png"),
    ]);
    const attachment = result.attachments[0]!;
    trashFile.mockRejectedValueOnce(new Error("Trash failed"));

    await expect(
      service.removeAttachment(task.id, attachment.id),
    ).rejects.toThrow("Trash failed");
    expect(store.getTask(task.id)?.attachments).toHaveLength(1);

    await service.removeAttachment(task.id, attachment.id);
    expect(store.getTask(task.id)?.attachments).toHaveLength(0);
  });
});
