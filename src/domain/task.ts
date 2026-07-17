export const MAX_TASK_DEPTH = 10;

export type Priority = "none" | "low" | "medium" | "high";

export interface TaskAttachment {
  id: string;
  path: string;
  name: string;
  mimeType: string;
  createdAt: number;
}

export interface TaskRecord {
  id: string;
  parentId: string | null;
  title: string;
  completed: boolean;
  description: string;
  tags: string[];
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  flagged: boolean;
  url: string | null;
  attachments: TaskAttachment[];
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface PluginData {
  schemaVersion: 1;
  showCompleted: boolean;
  tasks: TaskRecord[];
}

export type TaskUpdate = Partial<
  Pick<
    TaskRecord,
    | "title"
    | "description"
    | "tags"
    | "dueDate"
    | "dueTime"
    | "priority"
    | "flagged"
    | "url"
  >
>;

export interface CreateTaskInput {
  id?: string;
  parentId?: string | null;
  title?: string;
}

export type TaskErrorCode =
  | "attachment-invalid"
  | "cycle"
  | "data-invalid"
  | "date-invalid"
  | "depth-exceeded"
  | "duplicate-id"
  | "parent-missing"
  | "task-missing"
  | "time-invalid"
  | "title-empty"
  | "url-invalid";

export class TaskDomainError extends Error {
  constructor(
    public readonly code: TaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskDomainError";
  }
}
