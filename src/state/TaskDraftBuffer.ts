import { TaskStore } from "../domain/TaskStore";
import { TaskUpdate } from "../domain/task";

const TEXT_SAVE_DELAY_MS = 400;

export class TaskDraftBuffer {
  private readonly pending = new Map<string, TaskUpdate>();
  private readonly timers = new Map<string, number>();

  constructor(private readonly store: TaskStore) {}

  queue(taskId: string, update: TaskUpdate): void {
    this.pending.set(taskId, {
      ...this.pending.get(taskId),
      ...update,
    });

    const existingTimer = this.timers.get(taskId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    this.timers.set(
      taskId,
      window.setTimeout(() => {
        this.flush(taskId);
      }, TEXT_SAVE_DELAY_MS),
    );
  }

  flush(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.timers.delete(taskId);
    }

    const update = this.pending.get(taskId);
    if (!update) {
      return;
    }

    this.pending.delete(taskId);
    this.store.updateTask(taskId, update);
  }

  flushAll(): void {
    for (const taskId of [...this.pending.keys()]) {
      this.flush(taskId);
    }
  }
}
