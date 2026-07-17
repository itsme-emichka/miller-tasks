type TaskSelectionListener = () => void;

export class TaskSelection {
  private taskId: string | null = null;
  private readonly listeners = new Set<TaskSelectionListener>();

  getSelectedTaskId(): string | null {
    return this.taskId;
  }

  setSelectedTaskId(taskId: string | null): void {
    if (this.taskId === taskId) {
      return;
    }

    this.taskId = taskId;
    for (const listener of this.listeners) {
      listener();
    }
  }

  subscribe(listener: TaskSelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
