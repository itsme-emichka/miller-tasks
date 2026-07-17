import { TaskAttachment } from "../domain/task";

export interface TaskAttachmentActions {
  addFiles: (taskId: string, files: readonly File[]) => Promise<void>;
  getResourceUrl: (attachment: TaskAttachment) => string | null;
  openAttachment: (attachment: TaskAttachment) => Promise<void>;
  removeAttachment: (
    taskId: string,
    attachment: TaskAttachment,
  ) => Promise<void>;
}
