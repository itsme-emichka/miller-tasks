import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  JSX,
  KeyboardEvent,
  SyntheticEvent,
} from "react";

import { isTaskOverdue } from "../domain/due";
import { isTreeTaskVisible } from "../domain/daily";
import { TaskStore } from "../domain/TaskStore";
import {
  MAX_TASK_DEPTH,
  PluginData,
  TaskRecord,
} from "../domain/task";
import {
  performTaskDrop,
  TaskDragData,
  TaskDropData,
  TaskDropPlacement,
} from "./taskDrop";

interface MillerTasksAppProps {
  store: TaskStore;
  onTaskSelected?: (taskId: string | null) => void;
  onTaskCompletion?: (taskId: string, completed: boolean) => void;
  onTaskDelete?: (taskId: string) => void;
  onTaskMoveError?: (message: string) => void;
  clock?: () => number;
}

interface ColumnState {
  depth: number;
  parentId: string | null;
  selectedId: string | null;
}

type KeyboardNavigation =
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end";

interface FocusRequest {
  columnIndex: number;
  taskId: string | null;
}

export function MillerTasksApp({
  store,
  onTaskSelected,
  onTaskCompletion,
  onTaskDelete,
  onTaskMoveError,
  clock = Date.now,
}: MillerTasksAppProps): JSX.Element {
  const snapshot = useTaskSnapshot(store);
  const now = useCurrentMinute(clock);
  const todayTasks = useMemo(
    () => store.getTodayTasks(now),
    [now, snapshot, store],
  );
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(
    null,
  );
  const [focusRequest, setFocusRequest] =
    useState<FocusRequest | null>(null);
  const columnsElement = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedPath((currentPath) =>
      reconcileSelectedPath(currentPath, snapshot, now),
    );
  }, [now, snapshot]);

  useEffect(() => {
    onTaskSelected?.(selectedPath.at(-1) ?? null);
  }, [onTaskSelected, selectedPath]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }

    const column =
      columnsElement.current?.querySelectorAll<HTMLElement>(
        ".miller-tasks-column",
      )[focusRequest.columnIndex];
    const rows = column?.querySelectorAll<HTMLElement>(
      ".miller-task-row",
    );
    const row = focusRequest.taskId
      ? Array.from(rows ?? []).find(
          (candidate) =>
            candidate.dataset.taskId === focusRequest.taskId,
        )
      : undefined;
    const target = row
      ? row.querySelector<HTMLElement>(".miller-task-title")
      : column?.querySelector<HTMLElement>(
          ".miller-task-title, .miller-new-task input",
        );
    target?.focus({ preventScroll: true });
    setFocusRequest(null);
  }, [focusRequest, selectedPath, snapshot]);

  const columns = useMemo(
    () => buildColumns(selectedPath),
    [selectedPath],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const completeTask =
    onTaskCompletion ??
    ((taskId: string, completed: boolean) =>
      store.completeSubtree(taskId, completed));

  const selectTask = (taskId: string, columnIndex: number): void => {
    setSelectedPath((currentPath) => [
      ...currentPath.slice(0, columnIndex),
      taskId,
    ]);
    onTaskSelected?.(taskId);
  };

  const createTask = (
    title: string,
    parentId: string | null,
    columnIndex: number,
  ): void => {
    const created = store.createTask({ parentId, title });
    setSelectedPath((currentPath) => [
      ...currentPath.slice(0, columnIndex),
      created.id,
    ]);
    onTaskSelected?.(created.id);
  };

  const handleDragEnd = (event: DragEndEvent): void => {
    if (!event.over) {
      return;
    }

    const active = event.active.data.current as
      | TaskDragData
      | undefined;
    const over = event.over.data.current as TaskDropData | undefined;
    if (!active || active.type !== "task" || !over) {
      return;
    }

    try {
      performTaskDrop(
        store,
        active,
        over,
        getDropPlacement(event, active, over),
      );
    } catch (error) {
      onTaskMoveError?.(
        error instanceof Error ? error.message : "Task move failed.",
      );
    }
  };

  const handleKeyboardNavigation = (
    direction: KeyboardNavigation,
    task: TaskRecord,
    taskIndex: number,
    columnIndex: number,
    tasks: readonly TaskRecord[],
  ): void => {
    if (direction === "right") {
      if (columnIndex < MAX_TASK_DEPTH - 1) {
        selectTask(task.id, columnIndex);
        setFocusRequest({
          columnIndex: columnIndex + 1,
          taskId: null,
        });
      }
      return;
    }

    if (direction === "left") {
      const parentId = selectedPath[columnIndex - 1];
      if (columnIndex > 0 && parentId) {
        setSelectedPath((currentPath) =>
          currentPath.slice(0, columnIndex),
        );
        onTaskSelected?.(parentId);
        setFocusRequest({
          columnIndex: columnIndex - 1,
          taskId: parentId,
        });
      }
      return;
    }

    const targetIndex =
      direction === "home"
        ? 0
        : direction === "end"
          ? tasks.length - 1
          : taskIndex + (direction === "down" ? 1 : -1);
    const target = tasks[targetIndex];
    if (!target) {
      return;
    }
    selectTask(target.id, columnIndex);
    setFocusRequest({
      columnIndex,
      taskId: target.id,
    });
  };

  return (
    <main className="miller-tasks-shell">
      <h1>Miller Tasks</h1>
      <div className="miller-tasks-workspace">
        <section
          className="miller-today-column"
          aria-label="Tasks for today"
        >
          <div className="miller-tasks-list">
            {todayTasks.map((task, index) => (
              <Fragment key={task.id}>
                {task.dailyTemplateId !== null &&
                index > 0 &&
                todayTasks[index - 1]?.dailyTemplateId === null ? (
                  <div
                    className="miller-today-divider"
                    role="separator"
                  />
                ) : null}
                <TodayTaskRow
                  task={task}
                  onSelect={() => onTaskSelected?.(task.id)}
                  onTaskCompletion={completeTask}
                  onDelete={() => onTaskDelete?.(task.id)}
                />
              </Fragment>
            ))}
            {todayTasks.length === 0 ? (
              <p className="miller-today-empty">No tasks for today</p>
            ) : null}
          </div>
        </section>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={columnsElement}
            className="miller-tasks-columns"
            aria-label="Task hierarchy columns"
          >
            {columns.map((column, columnIndex) => (
              <TaskColumn
                key={column.parentId ?? "__root__"}
                column={column}
                tasks={getChildren(snapshot, column.parentId, now)}
                columnIndex={columnIndex}
                activeTaskId={selectedPath.at(-1) ?? null}
                editingTaskId={editingTaskId}
                onBeginEditing={setEditingTaskId}
                onFinishEditing={() => setEditingTaskId(null)}
                onSelectTask={selectTask}
                onCreateTask={createTask}
                onKeyboardNavigate={handleKeyboardNavigation}
                onTaskCompletion={completeTask}
                onTaskDelete={onTaskDelete}
                onToggleToday={(taskId, today) =>
                  store.setTaskToday(taskId, today)
                }
                store={store}
              />
            ))}
          </div>
        </DndContext>
      </div>
    </main>
  );
}

interface TodayTaskRowProps {
  task: TaskRecord;
  onSelect: () => void;
  onTaskCompletion: (taskId: string, completed: boolean) => void;
  onDelete: () => void;
}

function TodayTaskRow({
  task,
  onSelect,
  onTaskCompletion,
  onDelete,
}: TodayTaskRowProps): JSX.Element {
  const handleTitleKeyDown = (
    event: KeyboardEvent<HTMLSpanElement>,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDelete();
    }
  };

  return (
    <div
      className="miller-task-row miller-today-task-row"
      data-completed={task.completed}
      data-overdue={isTaskOverdue(task)}
      data-task-id={task.id}
    >
      <input
        className="task-list-item-checkbox miller-task-checkbox"
        type="checkbox"
        checked={task.completed}
        aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
        onChange={(event) =>
          onTaskCompletion(task.id, event.currentTarget.checked)
        }
      />
      <span
        className="miller-task-title"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onSelect();
        }}
        onKeyDown={handleTitleKeyDown}
      >
        {task.title}
      </span>
    </div>
  );
}

interface TaskColumnProps {
  column: ColumnState;
  tasks: TaskRecord[];
  columnIndex: number;
  activeTaskId: string | null;
  editingTaskId: string | null;
  onBeginEditing: (taskId: string) => void;
  onFinishEditing: () => void;
  onSelectTask: (taskId: string, columnIndex: number) => void;
  onCreateTask: (
    title: string,
    parentId: string | null,
    columnIndex: number,
  ) => void;
  onTaskCompletion: (taskId: string, completed: boolean) => void;
  onTaskDelete?: (taskId: string) => void;
  onToggleToday: (taskId: string, today: boolean) => void;
  onKeyboardNavigate: (
    direction: KeyboardNavigation,
    task: TaskRecord,
    taskIndex: number,
    columnIndex: number,
    tasks: readonly TaskRecord[],
  ) => void;
  store: TaskStore;
}

function TaskColumn({
  column,
  tasks,
  columnIndex,
  activeTaskId,
  editingTaskId,
  onBeginEditing,
  onFinishEditing,
  onSelectTask,
  onCreateTask,
  onTaskCompletion,
  onTaskDelete,
  onToggleToday,
  onKeyboardNavigate,
  store,
}: TaskColumnProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${column.parentId ?? "__root__"}`,
    data: {
      type: "column",
      parentId: column.parentId,
      index: tasks.length,
    } satisfies TaskDropData,
  });

  return (
    <section
      ref={setNodeRef}
      className="miller-tasks-column"
      aria-label={`Task level ${column.depth}`}
      data-drop-target={isOver}
    >
      <SortableContext
        items={tasks.map((task) => `task:${task.id}`)}
        strategy={verticalListSortingStrategy}
      >
        <div className="miller-tasks-list">
          {tasks.map((task, taskIndex) => (
            <TaskRow
              key={task.id}
              task={task}
              taskIndex={taskIndex}
              selected={column.selectedId === task.id}
              active={activeTaskId === task.id}
              editing={editingTaskId === task.id}
              onBeginEditing={() => onBeginEditing(task.id)}
              onFinishEditing={onFinishEditing}
              onSelect={() => onSelectTask(task.id, columnIndex)}
              onTaskCompletion={onTaskCompletion}
              onDelete={() => onTaskDelete?.(task.id)}
              todaySelected={store.isTaskScheduledForToday(task.id)}
              onToggleToday={onToggleToday}
              onKeyboardNavigate={(direction) =>
                onKeyboardNavigate(
                  direction,
                  task,
                  taskIndex,
                  columnIndex,
                  tasks,
                )
              }
              store={store}
            />
          ))}
          <NewTaskInput
            parentId={column.parentId}
            onCreate={(title) =>
              onCreateTask(title, column.parentId, columnIndex)
            }
          />
        </div>
      </SortableContext>
    </section>
  );
}

interface TaskRowProps {
  task: TaskRecord;
  taskIndex: number;
  selected: boolean;
  active: boolean;
  editing: boolean;
  onBeginEditing: () => void;
  onFinishEditing: () => void;
  onSelect: () => void;
  onTaskCompletion: (taskId: string, completed: boolean) => void;
  onDelete: () => void;
  todaySelected: boolean;
  onToggleToday: (taskId: string, today: boolean) => void;
  onKeyboardNavigate: (direction: KeyboardNavigation) => void;
  store: TaskStore;
}

function TaskRow({
  task,
  taskIndex,
  selected,
  active,
  editing,
  onBeginEditing,
  onFinishEditing,
  onSelect,
  onTaskCompletion,
  onDelete,
  todaySelected,
  onToggleToday,
  onKeyboardNavigate,
  store,
}: TaskRowProps): JSX.Element {
  const [draftTitle, setDraftTitle] = useState(task.title);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `task:${task.id}`,
    data: {
      type: "task",
      taskId: task.id,
      parentId: task.parentId,
      index: taskIndex,
    } satisfies TaskDragData,
  });

  useEffect(() => {
    setDraftTitle(task.title);
  }, [task.title]);

  const saveTitle = (): void => {
    try {
      store.updateTask(task.id, { title: draftTitle });
      onFinishEditing();
    } catch {
      setDraftTitle(task.title);
    }
  };

  const handleTitleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveTitle();
    } else if (event.key === "Escape") {
      setDraftTitle(task.title);
      onFinishEditing();
    }
  };

  const handleTaskKeyDown = (
    event: KeyboardEvent<HTMLSpanElement>,
  ): void => {
    if (isDragging) {
      listeners?.onKeyDown?.(event);
      return;
    }

    const navigationKeys: Partial<
      Record<string, KeyboardNavigation>
    > = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      Home: "home",
      End: "end",
    };
    const direction = navigationKeys[event.key];
    if (direction) {
      event.preventDefault();
      onKeyboardNavigate(direction);
      return;
    }
    if (event.key === "F2") {
      event.preventDefault();
      onBeginEditing();
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      onDelete();
      return;
    }
    listeners?.onKeyDown?.(event);
  };

  return (
    <div
      ref={setNodeRef}
      className="miller-task-row"
      data-selected={selected}
      data-active={active}
      data-completed={task.completed}
      data-overdue={isTaskOverdue(task)}
      data-dragging={isDragging}
      data-task-id={task.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <input
        className="task-list-item-checkbox miller-task-checkbox"
        type="checkbox"
        checked={task.completed}
        aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
        onChange={(event) =>
          onTaskCompletion(task.id, event.currentTarget.checked)
        }
      />
      {editing ? (
        <input
          className="miller-task-title-input"
          value={draftTitle}
          aria-label={`Rename ${task.title}`}
          autoFocus
          onChange={(event) => setDraftTitle(event.currentTarget.value)}
          onBlur={saveTitle}
          onKeyDown={handleTitleKeyDown}
        />
      ) : (
        <span
          className="miller-task-title"
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onSelect();
          }}
          onDoubleClick={onBeginEditing}
          {...attributes}
          {...listeners}
          onKeyDown={handleTaskKeyDown}
        >
          {task.title}
        </span>
      )}
      <button
        type="button"
        className="miller-task-today-toggle"
        data-active={todaySelected}
        aria-label={`${todaySelected ? "Remove" : "Add"} ${task.title} ${
          todaySelected ? "from" : "to"
        } today`}
        aria-pressed={todaySelected}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onToggleToday(task.id, !todaySelected);
        }}
      >
        <TodayIcon active={todaySelected} />
      </button>
    </div>
  );
}

function TodayIcon({ active }: { active: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
      {active ? (
        <path d="m8.5 14 2.2 2.2 4.8-5" />
      ) : (
        <path d="M12 12v6M9 15h6" />
      )}
    </svg>
  );
}

interface NewTaskInputProps {
  parentId: string | null;
  onCreate: (title: string) => void;
}

function NewTaskInput({
  parentId,
  onCreate,
}: NewTaskInputProps): JSX.Element {
  const [title, setTitle] = useState("");

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (title.trim() === "") {
      return;
    }
    onCreate(title);
    setTitle("");
  };

  return (
    <form className="miller-new-task" onSubmit={submit}>
      <input
        value={title}
        aria-label={
          parentId === null ? "New root task" : "New subtask"
        }
        placeholder="New task"
        onChange={(event) => setTitle(event.currentTarget.value)}
      />
    </form>
  );
}

function useTaskSnapshot(store: TaskStore): PluginData {
  const [revision, setRevision] = useState(0);

  useEffect(
    () => store.subscribe(() => setRevision((current) => current + 1)),
    [store],
  );

  return useMemo(() => store.getSnapshot(), [revision, store]);
}

function useCurrentMinute(clock: () => number): number {
  const [now, setNow] = useState(clock);

  useEffect(() => {
    setNow(clock());
    const interval = window.setInterval(
      () => setNow(clock()),
      60_000,
    );
    return () => window.clearInterval(interval);
  }, [clock]);

  return now;
}

function buildColumns(selectedPath: readonly string[]): ColumnState[] {
  const columns: ColumnState[] = [
    {
      depth: 1,
      parentId: null,
      selectedId: selectedPath[0] ?? null,
    },
  ];

  for (
    let index = 0;
    index < selectedPath.length && index < MAX_TASK_DEPTH - 1;
    index += 1
  ) {
    columns.push({
      depth: index + 2,
      parentId: selectedPath[index] ?? null,
      selectedId: selectedPath[index + 1] ?? null,
    });
  }
  return columns;
}

function getChildren(
  snapshot: PluginData,
  parentId: string | null,
  now: number,
): TaskRecord[] {
  return snapshot.tasks
    .filter(
      (task) =>
        task.parentId === parentId &&
        isTreeTaskVisible(task, snapshot.showCompleted, now),
    )
    .sort((left, right) => left.order - right.order);
}

function reconcileSelectedPath(
  selectedPath: readonly string[],
  snapshot: PluginData,
  now: number,
): string[] {
  for (let index = selectedPath.length - 1; index >= 0; index -= 1) {
    const taskId = selectedPath[index];
    if (!taskId) {
      continue;
    }
    const path = buildAncestryPath(taskId, snapshot, now);
    if (path) {
      if (
        path.length === selectedPath.length &&
        path.every((id, pathIndex) => id === selectedPath[pathIndex])
      ) {
        return selectedPath as string[];
      }
      return path;
    }
  }

  return [];
}

function buildAncestryPath(
  taskId: string,
  snapshot: PluginData,
  now: number,
): string[] | null {
  const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const reversedPath: string[] = [];
  let current = byId.get(taskId);

  while (current) {
    if (!isTreeTaskVisible(current, snapshot.showCompleted, now)) {
      return null;
    }
    reversedPath.push(current.id);
    current =
      current.parentId === null ? undefined : byId.get(current.parentId);
  }

  if (reversedPath.length === 0) {
    return null;
  }
  return reversedPath.reverse();
}

function getDropPlacement(
  event: DragEndEvent,
  active: TaskDragData,
  over: TaskDropData,
): TaskDropPlacement {
  if (over.type === "column" || active.parentId === over.parentId) {
    return "inside";
  }

  const translated = event.active.rect.current.translated;
  if (!translated || event.over === null || event.over.rect.height === 0) {
    return "inside";
  }

  const center = translated.top + translated.height / 2;
  const ratio = (center - event.over.rect.top) / event.over.rect.height;
  if (ratio < 0.25) {
    return "before";
  }
  if (ratio > 0.75) {
    return "after";
  }
  return "inside";
}
