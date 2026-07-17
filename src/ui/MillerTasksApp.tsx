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
  onTaskMoveError?: (message: string) => void;
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
  onTaskMoveError,
}: MillerTasksAppProps): JSX.Element {
  const snapshot = useTaskSnapshot(store);
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(
    null,
  );
  const [focusRequest, setFocusRequest] =
    useState<FocusRequest | null>(null);
  const columnsElement = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedPath((currentPath) =>
      reconcileSelectedPath(currentPath, snapshot),
    );
  }, [snapshot]);

  useEffect(() => {
    onTaskSelected?.(selectedPath.at(-1) ?? null);
  }, [onTaskSelected, selectedPath]);

  useEffect(() => {
    const columns = columnsElement.current;
    if (!columns) {
      return;
    }

    columns.lastElementChild?.scrollIntoView?.({
      block: "nearest",
      inline: "end",
    });
  }, [selectedPath]);

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
    target?.focus();
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
              tasks={getChildren(snapshot, column.parentId)}
              columnIndex={columnIndex}
              editingTaskId={editingTaskId}
              onBeginEditing={setEditingTaskId}
              onFinishEditing={() => setEditingTaskId(null)}
              onSelectTask={selectTask}
              onCreateTask={createTask}
              onKeyboardNavigate={handleKeyboardNavigation}
              onTaskCompletion={
                onTaskCompletion ??
                ((taskId, completed) =>
                  store.completeSubtree(taskId, completed))
              }
              store={store}
            />
          ))}
        </div>
      </DndContext>
    </main>
  );
}

interface TaskColumnProps {
  column: ColumnState;
  tasks: TaskRecord[];
  columnIndex: number;
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
  editingTaskId,
  onBeginEditing,
  onFinishEditing,
  onSelectTask,
  onCreateTask,
  onTaskCompletion,
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
              editing={editingTaskId === task.id}
              onBeginEditing={() => onBeginEditing(task.id)}
              onFinishEditing={onFinishEditing}
              onSelect={() => onSelectTask(task.id, columnIndex)}
              onTaskCompletion={onTaskCompletion}
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
  editing: boolean;
  onBeginEditing: () => void;
  onFinishEditing: () => void;
  onSelect: () => void;
  onTaskCompletion: (taskId: string, completed: boolean) => void;
  onKeyboardNavigate: (direction: KeyboardNavigation) => void;
  store: TaskStore;
}

function TaskRow({
  task,
  taskIndex,
  selected,
  editing,
  onBeginEditing,
  onFinishEditing,
  onSelect,
  onTaskCompletion,
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
    event: KeyboardEvent<HTMLButtonElement>,
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
    listeners?.onKeyDown?.(event);
  };

  return (
    <div
      ref={setNodeRef}
      className="miller-task-row"
      data-selected={selected}
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
        className="miller-task-checkbox"
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
        <button
          className="miller-task-title"
          type="button"
          onClick={onSelect}
          onDoubleClick={onBeginEditing}
          {...attributes}
          {...listeners}
          onKeyDown={handleTaskKeyDown}
        >
          {task.title}
        </button>
      )}
    </div>
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
): TaskRecord[] {
  return snapshot.tasks
    .filter(
      (task) =>
        task.parentId === parentId &&
        (snapshot.showCompleted || !task.completed),
    )
    .sort((left, right) => left.order - right.order);
}

function reconcileSelectedPath(
  selectedPath: readonly string[],
  snapshot: PluginData,
): string[] {
  for (let index = selectedPath.length - 1; index >= 0; index -= 1) {
    const taskId = selectedPath[index];
    if (!taskId) {
      continue;
    }
    const path = buildAncestryPath(taskId, snapshot);
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
): string[] | null {
  const byId = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const reversedPath: string[] = [];
  let current = byId.get(taskId);

  while (current) {
    if (!snapshot.showCompleted && current.completed) {
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
