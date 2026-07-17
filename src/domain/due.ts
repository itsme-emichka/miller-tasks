import { TaskRecord } from "./task";

export function isTaskOverdue(
  task: Pick<TaskRecord, "completed" | "dueDate" | "dueTime">,
  now = new Date(),
): boolean {
  if (task.completed || task.dueDate === null) {
    return false;
  }

  const today = formatLocalDate(now);
  if (task.dueDate < today) {
    return true;
  }
  if (task.dueDate > today || task.dueTime === null) {
    return false;
  }

  const currentTime =
    `${String(now.getHours()).padStart(2, "0")}:` +
    String(now.getMinutes()).padStart(2, "0");
  return task.dueTime < currentTime;
}

function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
