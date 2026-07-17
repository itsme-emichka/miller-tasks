import { TaskStore } from "../domain/TaskStore";

export interface TaskDragData {
  type: "task";
  taskId: string;
  parentId: string | null;
  index: number;
}

export type TaskDropData =
  | TaskDragData
  | {
      type: "column";
      parentId: string | null;
      index: number;
    };

export type TaskDropPlacement = "before" | "inside" | "after";

export function performTaskDrop(
  store: TaskStore,
  active: TaskDragData,
  over: TaskDropData,
  placement: TaskDropPlacement = "inside",
): void {
  if (over.type === "column") {
    store.moveTask(active.taskId, over.parentId, over.index);
    return;
  }

  if (active.taskId === over.taskId) {
    return;
  }

  if (active.parentId === over.parentId) {
    store.reorderTask(active.taskId, over.index);
    return;
  }

  if (placement === "inside") {
    store.moveTask(active.taskId, over.taskId);
    return;
  }

  store.moveTask(
    active.taskId,
    over.parentId,
    over.index + (placement === "after" ? 1 : 0),
  );
}
