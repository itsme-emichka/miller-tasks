export interface TaskActions {
  deleteTask: (taskId: string) => Promise<void>;
}
