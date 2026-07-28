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
  today: boolean;
  todayAddedAt: number | null;
  dailyTemplateId: string | null;
  generatedForDate: string | null;
}

export interface DailyTaskTemplate {
  id: string;
  title: string;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface PluginData {
  schemaVersion: 2;
  showCompleted: boolean;
  tasks: TaskRecord[];
  dailyTemplates: DailyTaskTemplate[];
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
  | "daily-template-missing"
  | "daily-task-invalid"
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
