import {
  App,
  normalizePath,
  TFile,
} from "obsidian";

import { TaskStore } from "../domain/TaskStore";
import {
  TaskAttachment,
  TaskRecord,
} from "../domain/task";

const ATTACHMENT_ROOT = "Miller Tasks/Attachments";

export interface AttachmentImportResult {
  attachments: TaskAttachment[];
  errors: unknown[];
}

interface TaskAttachmentServiceOptions {
  idFactory?: () => string;
  now?: () => number;
}

export class TaskAttachmentService {
  private readonly idFactory: () => string;
  private readonly now: () => number;

  constructor(
    private readonly app: App,
    private readonly store: TaskStore,
    options: TaskAttachmentServiceOptions = {},
  ) {
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.now = options.now ?? (() => Date.now());
  }

  async addFiles(
    taskId: string,
    files: readonly File[],
  ): Promise<AttachmentImportResult> {
    const result: AttachmentImportResult = {
      attachments: [],
      errors: [],
    };

    for (const file of files) {
      try {
        result.attachments.push(await this.addFile(taskId, file));
      } catch (error) {
        result.errors.push(error);
      }
    }
    return result;
  }

  getResourceUrl(attachment: TaskAttachment): string | null {
    const file = this.app.vault.getAbstractFileByPath(attachment.path);
    return file instanceof TFile
      ? this.app.vault.getResourcePath(file)
      : null;
  }

  async openAttachment(attachment: TaskAttachment): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(attachment.path);
    if (!(file instanceof TFile)) {
      throw new Error(`Attachment file is missing: ${attachment.name}`);
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async removeAttachment(
    taskId: string,
    attachmentId: string,
  ): Promise<void> {
    const task = this.store.getTask(taskId);
    const attachment = task?.attachments.find(
      (candidate) => candidate.id === attachmentId,
    );
    if (!attachment) {
      throw new Error("Attachment record is missing.");
    }

    await this.trashPath(attachment.path);
    this.store.removeAttachment(taskId, attachmentId);
  }

  async trashTaskAttachments(
    tasks: readonly TaskRecord[],
  ): Promise<void> {
    const paths = new Set(
      tasks.flatMap((task) =>
        task.attachments.map((attachment) => attachment.path),
      ),
    );
    for (const path of paths) {
      await this.trashPath(path);
    }
  }

  private async addFile(
    taskId: string,
    file: File,
  ): Promise<TaskAttachment> {
    if (!file.type.startsWith("image/")) {
      throw new Error(`Only image files are supported: ${file.name}`);
    }
    if (!this.store.getTask(taskId)) {
      throw new Error("Select an existing task before adding images.");
    }

    const attachmentId = this.idFactory();
    const folder = normalizePath(`${ATTACHMENT_ROOT}/${taskId}`);
    await this.ensureFolder(folder);
    const safeName = sanitizeFilename(file.name);
    const path = normalizePath(
      `${folder}/${attachmentId}-${safeName}`,
    );
    const created = await this.app.vault.createBinary(
      path,
      await file.arrayBuffer(),
    );
    const attachment: TaskAttachment = {
      id: attachmentId,
      path,
      name: file.name || safeName,
      mimeType: file.type,
      createdAt: this.now(),
    };

    try {
      this.store.addAttachment(taskId, attachment);
    } catch (error) {
      await this.app.fileManager.trashFile(created).catch(() => undefined);
      throw error;
    }
    return attachment;
  }

  private async ensureFolder(path: string): Promise<void> {
    const segments = normalizePath(path).split("/");
    let current = "";

    for (const segment of segments) {
      current = current === "" ? segment : `${current}/${segment}`;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async trashPath(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) {
      await this.app.fileManager.trashFile(file);
    }
  }
}

function sanitizeFilename(filename: string): string {
  const safe = filename
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return safe || "image";
}
