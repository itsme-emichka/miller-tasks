export const COMPLETED_TODAY_RETENTION_MS = 24 * 60 * 60 * 1_000;

export function formatLocalDate(value: number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function isTodayTaskVisible(
  task: {
    today: boolean;
    completed: boolean;
    completedAt: number | null;
    dailyTemplateId: string | null;
    generatedForDate: string | null;
  },
  now: number,
): boolean {
  if (task.dailyTemplateId !== null) {
    return task.generatedForDate === formatLocalDate(now);
  }
  if (!task.today || !task.completed) {
    return task.today;
  }
  return (
    task.completedAt !== null &&
    task.completedAt + COMPLETED_TODAY_RETENTION_MS > now
  );
}

export function isTreeTaskVisible(
  task: {
    completed: boolean;
    completedAt: number | null;
    dailyTemplateId: string | null;
  },
  showCompleted: boolean,
  now: number,
): boolean {
  if (task.dailyTemplateId !== null) {
    return false;
  }
  if (!task.completed || showCompleted) {
    return true;
  }
  return (
    task.completedAt !== null &&
    formatLocalDate(task.completedAt) === formatLocalDate(now)
  );
}
