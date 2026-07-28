import { TaskStore } from "../domain/TaskStore";
import { TaskSelection } from "./TaskSelection";

export const TASK_ROLLOVER_INTERVAL_MS = 60_000;

export function runTaskRollover(
  store: TaskStore,
  selection: TaskSelection,
  now?: number,
): ReturnType<TaskStore["rollover"]> {
  const selectedTaskId = selection.getSelectedTaskId();
  const result = store.rollover(now);
  if (
    selectedTaskId !== null &&
    result.removed.some((task) => task.id === selectedTaskId)
  ) {
    selection.setSelectedTaskId(null);
  }
  return result;
}
