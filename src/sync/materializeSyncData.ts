import {
  DailyTaskTemplate,
  PluginData,
  TaskRecord,
} from "../domain/task";
import {
  isAttachmentPresent,
  isEntityPresent,
} from "./mergeSyncData";
import { comparePositionKeys } from "./positionKey";
import {
  PluginDataV3,
  SyncedDailyOccurrence,
  SyncedDailyTemplate,
  SyncedTask,
} from "./syncData";

export function materializePluginDataV3(
  data: PluginDataV3,
): PluginData {
  const templates = data.dailyTemplates
    .filter((template) =>
      isEntityPresent(data, "daily-template", template.id),
    )
    .sort(comparePositioned)
    .map(materializeTemplate);
  const templateById = new Map(
    templates.map((template) => [template.id, template]),
  );
  const tasks = data.tasks.filter((task) =>
    isEntityPresent(data, "task", task.id),
  );
  const orderById = createSiblingOrder(tasks);
  const treeTasks = tasks.map((task) =>
    materializeTask(data, task, orderById.get(task.id) ?? 0),
  );
  const dailyTasks = data.dailyOccurrences
    .filter(
      (occurrence) =>
        isEntityPresent(data, "daily-occurrence", occurrence.id) &&
        templateById.has(occurrence.templateId),
    )
    .map((occurrence) =>
      materializeOccurrence(
        occurrence,
        templateById.get(occurrence.templateId)!,
      ),
    );

  return {
    schemaVersion: 2,
    showCompleted: data.showCompleted,
    tasks: [...treeTasks, ...dailyTasks],
    dailyTemplates: templates,
  };
}

function materializeTask(
  data: PluginDataV3,
  task: SyncedTask,
  order: number,
): TaskRecord {
  return {
    id: task.id,
    parentId: task.parentId,
    title: task.title,
    completed: task.completed,
    description: task.description,
    tags: [...task.tags],
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    priority: task.priority,
    flagged: task.flagged,
    url: task.url,
    attachments: task.attachments
      .filter((attachment) =>
        isAttachmentPresent(data, task.id, attachment.id),
      )
      .map(({ added: _added, ...attachment }) => attachment),
    order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    completedAt: task.completedAt,
    today: task.today,
    todayAddedAt: task.todayAddedAt,
    dailyTemplateId: null,
    generatedForDate: null,
  };
}

function materializeTemplate(
  template: SyncedDailyTemplate,
  order: number,
): DailyTaskTemplate {
  return {
    id: template.id,
    title: template.title,
    order,
    createdAt: template.createdAt,
    updatedAt: template.updatedAt,
  };
}

function materializeOccurrence(
  occurrence: SyncedDailyOccurrence,
  template: DailyTaskTemplate,
): TaskRecord {
  return {
    id: occurrence.id,
    parentId: null,
    title: template.title,
    completed: occurrence.completed,
    description: occurrence.description,
    tags: [...occurrence.tags],
    dueDate: occurrence.dueDate,
    dueTime: occurrence.dueTime,
    priority: occurrence.priority,
    flagged: occurrence.flagged,
    url: occurrence.url,
    attachments: [],
    order: template.order,
    createdAt: occurrence.createdAt,
    updatedAt: Math.max(occurrence.updatedAt, template.updatedAt),
    completedAt: occurrence.completedAt,
    today: true,
    todayAddedAt: occurrence.todayAddedAt,
    dailyTemplateId: occurrence.templateId,
    generatedForDate: occurrence.date,
  };
}

function createSiblingOrder(
  tasks: readonly SyncedTask[],
): Map<string, number> {
  const siblings = new Map<string | null, SyncedTask[]>();
  for (const task of tasks) {
    const group = siblings.get(task.parentId) ?? [];
    group.push(task);
    siblings.set(task.parentId, group);
  }
  const result = new Map<string, number>();
  for (const group of siblings.values()) {
    group
      .sort(comparePositioned)
      .forEach((task, order) => result.set(task.id, order));
  }
  return result;
}

function comparePositioned(
  left: { id: string; positionKey: string },
  right: { id: string; positionKey: string },
): number {
  const position = comparePositionKeys(
    left.positionKey,
    right.positionKey,
  );
  if (position !== 0) {
    return position;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
