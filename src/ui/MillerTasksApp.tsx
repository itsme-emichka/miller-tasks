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
  CSSProperties,
  JSX,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
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
import { MillerViewHeader } from "./MillerViewHeader";

interface MillerTasksAppProps {
  store: TaskStore;
  onToggleView?: () => void;
  onTaskSelected?: (taskId: string | null) => void;
  onTaskInspectorRequested?: (
    taskId: string,
    presentation: TaskInspectorPresentation,
  ) => void;
  onCompactLayoutChange?: (compact: boolean) => void;
  onTaskCompletion?: (taskId: string, completed: boolean) => void;
  onTaskDelete?: (taskId: string) => void;
  onTaskMoveError?: (message: string) => void;
  clock?: () => number;
  compactLayout?: boolean;
}

export type TaskInspectorPresentation = "sidebar" | "popup";

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
  onToggleView,
  onTaskSelected,
  onTaskInspectorRequested,
  onCompactLayoutChange,
  onTaskCompletion,
  onTaskDelete,
  onTaskMoveError,
  clock = Date.now,
  compactLayout,
}: MillerTasksAppProps): JSX.Element {
  const detectedCompactLayout = useCompactLayout();
  const isCompact = compactLayout ?? detectedCompactLayout;
  const snapshot = useTaskSnapshot(store);
  const now = useCurrentMinute(clock);
  const todayTasks = useMemo(
    () => store.getTodayTasks(now),
    [now, snapshot, store],
  );
  const [showCompletedToday, setShowCompletedToday] = useState(false);
  const [todaySheetOpen, setTodaySheetOpen] = useState(false);
  const completedTodayCount = useMemo(
    () => todayTasks.filter((task) => task.completed).length,
    [todayTasks],
  );
  const openTodayCount = todayTasks.length - completedTodayCount;
  const visibleTodayTasks = useMemo(
    () =>
      isCompact && !showCompletedToday
        ? todayTasks.filter((task) => !task.completed)
        : todayTasks,
    [isCompact, showCompletedToday, todayTasks],
  );
  const taskTitleById = useMemo(
    () =>
      new Map(
        snapshot.tasks.map((task) => [task.id, task.title]),
      ),
    [snapshot],
  );
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(
    null,
  );
  const [focusRequest, setFocusRequest] =
    useState<FocusRequest | null>(null);
  const workspaceElement = useRef<HTMLDivElement | null>(null);
  const columnsElement = useRef<HTMLDivElement | null>(null);
  const todaySheetElement = useRef<HTMLElement | null>(null);
  const todaySheetHandleElement =
    useRef<HTMLButtonElement | null>(null);
  const todaySheetContentElement = useRef<HTMLDivElement | null>(null);
  useNativeTouchGestureBoundary(
    isCompact,
    columnsElement,
    false,
  );
  const mobileNavbarInset = useObsidianMobileNavbarInset(
    isCompact,
    workspaceElement,
  );
  const todaySheetGesture = useTodaySheetGesture(
    isCompact,
    todaySheetOpen,
    setTodaySheetOpen,
    todaySheetElement,
    todaySheetHandleElement,
  );

  useEffect(() => {
    setSelectedPath((currentPath) =>
      reconcileSelectedPath(currentPath, snapshot, now),
    );
  }, [now, snapshot]);

  useEffect(() => {
    onTaskSelected?.(selectedPath.at(-1) ?? null);
  }, [onTaskSelected, selectedPath]);

  useEffect(() => {
    if (!isCompact) {
      setShowCompletedToday(false);
      setTodaySheetOpen(false);
    }
  }, [isCompact]);

  useEffect(() => {
    const content = todaySheetContentElement.current;
    if (!content) {
      return;
    }
    content.inert = isCompact && !todaySheetOpen;
  }, [isCompact, todaySheetOpen]);

  useEffect(() => {
    onCompactLayoutChange?.(isCompact);
  }, [isCompact, onCompactLayoutChange]);

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
    if (!isCompact) {
      onTaskInspectorRequested?.(taskId, "sidebar");
    }
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
    if (!isCompact) {
      onTaskInspectorRequested?.(created.id, "sidebar");
    }
  };

  const selectTodayTask = (taskId: string): void => {
    onTaskSelected?.(taskId);
    if (!isCompact) {
      onTaskInspectorRequested?.(taskId, "sidebar");
    }
  };

  const openCompactInspector = (taskId: string): void => {
    onTaskSelected?.(taskId);
    onTaskInspectorRequested?.(taskId, "popup");
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

  const stopCompactPointerGesture = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (isCompact && event.pointerType === "touch") {
      stopObsidianGesturePropagation(event);
    }
  };

  return (
    <main
      className="miller-tasks-shell"
      data-compact={isCompact}
    >
      <MillerViewHeader
        mode="columns"
        onToggleView={onToggleView}
      />
      <div
        ref={workspaceElement}
        className="miller-tasks-workspace"
        style={
          mobileNavbarInset === null
            ? undefined
            : ({
                "--miller-mobile-navbar-inset": `${mobileNavbarInset}px`,
              } as CSSProperties)
        }
      >
        <section
          ref={todaySheetElement}
          className="miller-today-column miller-today-sheet"
          aria-label="Tasks for today"
          data-open={todaySheetOpen}
          data-dragging={todaySheetGesture.dragging}
          style={
            {
              "--miller-today-sheet-drag": `${todaySheetGesture.dragOffset}px`,
            } as CSSProperties
          }
        >
          {isCompact ? (
            <button
              ref={todaySheetHandleElement}
              type="button"
              className="miller-today-sheet-handle"
              aria-controls="miller-today-sheet-content"
              aria-expanded={todaySheetOpen}
              aria-label={
                todaySheetOpen
                  ? "Close Today"
                  : `Open Today${
                      openTodayCount > 0
                        ? `, ${openTodayCount} open ${
                            openTodayCount === 1 ? "task" : "tasks"
                          }`
                        : ""
                    }`
              }
              {...todaySheetGesture.handlers}
            >
              <span
                className="miller-today-sheet-grip"
                aria-hidden="true"
              />
              <span className="miller-today-sheet-label">Today</span>
              <span
                className="miller-today-sheet-count"
                aria-hidden="true"
              >
                {openTodayCount}
              </span>
            </button>
          ) : null}
          <div
            ref={todaySheetContentElement}
            id="miller-today-sheet-content"
            className="miller-today-sheet-content"
            aria-hidden={isCompact && !todaySheetOpen}
          >
            <div className="miller-tasks-list">
              {visibleTodayTasks.map((task, index) => (
                <Fragment key={task.id}>
                  {task.dailyTemplateId !== null &&
                  index > 0 &&
                  visibleTodayTasks[index - 1]?.dailyTemplateId ===
                    null ? (
                    <div
                      className="miller-today-divider"
                      role="separator"
                    />
                  ) : null}
                  <TodayTaskRow
                    task={task}
                    parentTitle={
                      task.parentId === null
                        ? null
                        : taskTitleById.get(task.parentId) ?? null
                    }
                    compact={isCompact}
                    onSelect={() => selectTodayTask(task.id)}
                    onOpenInspector={() =>
                      openCompactInspector(task.id)
                    }
                    onTaskCompletion={completeTask}
                    onDelete={() => onTaskDelete?.(task.id)}
                  />
                </Fragment>
              ))}
              {visibleTodayTasks.length === 0 ? (
                <p className="miller-today-empty">
                  {isCompact && completedTodayCount > 0
                    ? "No open tasks for today"
                    : "No tasks for today"}
                </p>
              ) : null}
            </div>
            {isCompact && completedTodayCount > 0 ? (
              <button
                type="button"
                className="miller-today-completed-toggle"
                data-expanded={showCompletedToday}
                aria-expanded={showCompletedToday}
                aria-label={
                  showCompletedToday
                    ? "Hide completed tasks"
                    : `Show ${completedTodayCount} completed ${
                        completedTodayCount === 1 ? "task" : "tasks"
                      }`
                }
                onClick={() =>
                  setShowCompletedToday((current) => !current)
                }
              >
                <ChevronIcon />
              </button>
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
            onPointerDown={stopCompactPointerGesture}
            onPointerMove={stopCompactPointerGesture}
            onPointerUp={stopCompactPointerGesture}
            onPointerCancel={stopCompactPointerGesture}
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
                compact={isCompact}
                onOpenInspector={openCompactInspector}
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
  parentTitle: string | null;
  compact: boolean;
  onSelect: () => void;
  onOpenInspector: () => void;
  onTaskCompletion: (taskId: string, completed: boolean) => void;
  onDelete: () => void;
}

function TodayTaskRow({
  task,
  parentTitle,
  compact,
  onSelect,
  onOpenInspector,
  onTaskCompletion,
  onDelete,
}: TodayTaskRowProps): JSX.Element {
  const longPress = useLongPress(compact, onOpenInspector);
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
      <div className="miller-today-task-copy">
        <span
          className="miller-task-title"
          role="button"
          tabIndex={0}
          {...longPress}
          onClick={(event) => {
            event.currentTarget.focus({ preventScroll: true });
            onSelect();
          }}
          onKeyDown={handleTitleKeyDown}
        >
          {task.title}
        </span>
        {parentTitle ? (
          <span className="miller-today-parent">{parentTitle}</span>
        ) : null}
      </div>
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
  compact: boolean;
  onOpenInspector: (taskId: string) => void;
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
  compact,
  onOpenInspector,
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
              compact={compact}
              onOpenInspector={() => onOpenInspector(task.id)}
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
  compact: boolean;
  onOpenInspector: () => void;
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
  compact,
  onOpenInspector,
  onKeyboardNavigate,
  store,
}: TaskRowProps): JSX.Element {
  const [draftTitle, setDraftTitle] = useState(task.title);
  const longPress = useLongPress(compact, onOpenInspector);
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
          {...longPress}
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

function ChevronIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
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

const COMPACT_LAYOUT_MAX_WIDTH = 720;
const LONG_PRESS_DELAY_MS = 550;
const LONG_PRESS_MOVE_TOLERANCE = 10;
const TODAY_SHEET_MOVE_TOLERANCE = 6;
const TODAY_SHEET_SWIPE_THRESHOLD = 48;
const TODAY_SHEET_FLICK_VELOCITY = 0.5;

interface TodaySheetGestureHandlers {
  onPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onPointerMove: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onPointerUp: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onPointerCancel: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

interface TodaySheetGestureResult {
  handlers: TodaySheetGestureHandlers;
  dragOffset: number;
  dragging: boolean;
}

interface TodaySheetGestureState {
  pointerId: number;
  startY: number;
  startTime: number;
  travel: number;
  openAtStart: boolean;
  moved: boolean;
}

function useTodaySheetGesture(
  enabled: boolean,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  sheetElement: RefObject<HTMLElement | null>,
  handleElement: RefObject<HTMLButtonElement | null>,
): TodaySheetGestureResult {
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<TodaySheetGestureState | null>(null);
  const suppressClick = useRef(false);
  useNativeTouchGestureBoundary(enabled, handleElement, true);

  const finishGesture = (
    event: ReactPointerEvent<HTMLButtonElement>,
    cancelled: boolean,
  ): void => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const displacement = event.clientY - current.startY;
    const elapsed = Math.max(1, event.timeStamp - current.startTime);
    const velocity = displacement / elapsed;
    const threshold = Math.min(
      72,
      Math.max(TODAY_SHEET_SWIPE_THRESHOLD, current.travel * 0.15),
    );
    let nextOpen = current.openAtStart;

    if (!cancelled) {
      if (current.moved) {
        if (
          displacement <= -threshold ||
          velocity <= -TODAY_SHEET_FLICK_VELOCITY
        ) {
          nextOpen = true;
        } else if (
          displacement >= threshold ||
          velocity >= TODAY_SHEET_FLICK_VELOCITY
        ) {
          nextOpen = false;
        }
      } else {
        nextOpen = !current.openAtStart;
      }
      suppressClick.current = true;
    }

    if (
      event.currentTarget.hasPointerCapture?.(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    gesture.current = null;
    setDragOffset(0);
    setDragging(false);
    onOpenChange(nextOpen);
  };

  return {
    dragOffset,
    dragging,
    handlers: {
      onPointerDown: (event) => {
        stopObsidianGesture(event);
        if (event.button > 0 || event.isPrimary === false) {
          return;
        }
        const sheetHeight =
          sheetElement.current?.getBoundingClientRect().height ?? 0;
        const handleHeight =
          handleElement.current?.getBoundingClientRect().height ?? 0;
        suppressClick.current = false;
        gesture.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startTime: event.timeStamp,
          travel: Math.max(0, sheetHeight - handleHeight),
          openAtStart: open,
          moved: false,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
        setDragOffset(0);
        setDragging(true);
      },
      onPointerMove: (event) => {
        stopObsidianGesture(event);
        const current = gesture.current;
        if (!current || current.pointerId !== event.pointerId) {
          return;
        }
        const displacement = event.clientY - current.startY;
        if (
          Math.abs(displacement) > TODAY_SHEET_MOVE_TOLERANCE
        ) {
          current.moved = true;
        }
        setDragOffset(
          current.openAtStart
            ? Math.min(current.travel, Math.max(0, displacement))
            : Math.max(-current.travel, Math.min(0, displacement)),
        );
      },
      onPointerUp: (event) => {
        stopObsidianGesture(event);
        finishGesture(event, false);
      },
      onPointerCancel: (event) => {
        stopObsidianGesture(event);
        finishGesture(event, true);
      },
      onClick: (event) => {
        stopObsidianGesture(event);
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onOpenChange(!open);
      },
    },
  };
}

const MOBILE_NAVBAR_GAP = 8;

function useNativeTouchGestureBoundary<T extends HTMLElement>(
  enabled: boolean,
  elementRef: RefObject<T | null>,
  preventDefault: boolean,
): void {
  useEffect(() => {
    const element = elementRef.current;
    if (!enabled || !element) {
      return;
    }

    const containTouchGesture = (event: TouchEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || !element.contains(target)) {
        return;
      }
      if (preventDefault) {
        event.preventDefault();
      }
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const options = {
      capture: true,
      passive: !preventDefault,
    } as const;
    window.addEventListener(
      "touchstart",
      containTouchGesture,
      options,
    );
    window.addEventListener(
      "touchmove",
      containTouchGesture,
      options,
    );
    window.addEventListener(
      "touchend",
      containTouchGesture,
      options,
    );
    window.addEventListener(
      "touchcancel",
      containTouchGesture,
      options,
    );

    return () => {
      window.removeEventListener(
        "touchstart",
        containTouchGesture,
        true,
      );
      window.removeEventListener(
        "touchmove",
        containTouchGesture,
        true,
      );
      window.removeEventListener(
        "touchend",
        containTouchGesture,
        true,
      );
      window.removeEventListener(
        "touchcancel",
        containTouchGesture,
        true,
      );
    };
  }, [elementRef, enabled, preventDefault]);
}

function useObsidianMobileNavbarInset(
  enabled: boolean,
  workspaceElement: RefObject<HTMLDivElement | null>,
): number | null {
  const [inset, setInset] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setInset(null);
      return;
    }

    let animationFrame: number | null = null;
    let observedNavbar: HTMLElement | null = null;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => scheduleMeasurement());
    const navbarObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => scheduleMeasurement());

    const observeNavbar = (navbar: HTMLElement | null): void => {
      if (navbar === observedNavbar) {
        return;
      }
      if (observedNavbar) {
        resizeObserver?.unobserve(observedNavbar);
      }
      navbarObserver?.disconnect();
      observedNavbar = navbar;
      if (navbar) {
        resizeObserver?.observe(navbar);
        navbarObserver?.observe(navbar, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }
    };

    const measure = (): void => {
      animationFrame = null;
      const workspace = workspaceElement.current;
      const navbar =
        document.querySelector<HTMLElement>(".mobile-navbar");
      observeNavbar(navbar);
      if (!workspace || !navbar) {
        setInset(null);
        return;
      }

      const workspaceRect = workspace.getBoundingClientRect();
      const navbarRect = navbar.getBoundingClientRect();
      const horizontalOverlap =
        Math.min(workspaceRect.right, navbarRect.right) -
        Math.max(workspaceRect.left, navbarRect.left);
      const verticalOverlap =
        Math.min(workspaceRect.bottom, navbarRect.bottom) -
        Math.max(workspaceRect.top, navbarRect.top);
      if (
        navbarRect.width <= 0 ||
        navbarRect.height <= 0 ||
        horizontalOverlap <= 0 ||
        verticalOverlap <= 0
      ) {
        setInset(null);
        return;
      }

      const nextInset = Math.min(
        workspaceRect.height,
        Math.max(
          0,
          workspaceRect.bottom -
            navbarRect.top +
            MOBILE_NAVBAR_GAP,
        ),
      );
      setInset((current) =>
        current === nextInset ? current : nextInset,
      );
    };

    function scheduleMeasurement(): void {
      if (animationFrame !== null) {
        return;
      }
      if (typeof window.requestAnimationFrame !== "function") {
        measure();
        return;
      }
      animationFrame = window.requestAnimationFrame(measure);
    }

    const bodyObserver =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => scheduleMeasurement());
    if (document.body) {
      bodyObserver?.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
    if (workspaceElement.current) {
      resizeObserver?.observe(workspaceElement.current);
    }
    window.addEventListener("resize", scheduleMeasurement);
    window.visualViewport?.addEventListener(
      "resize",
      scheduleMeasurement,
    );
    window.visualViewport?.addEventListener(
      "scroll",
      scheduleMeasurement,
    );
    measure();

    return () => {
      if (
        animationFrame !== null &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(animationFrame);
      }
      bodyObserver?.disconnect();
      navbarObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasurement);
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleMeasurement,
      );
      window.visualViewport?.removeEventListener(
        "scroll",
        scheduleMeasurement,
      );
    };
  }, [enabled, workspaceElement]);

  return inset;
}

function stopObsidianGesture(event: SyntheticEvent): void {
  event.preventDefault();
  stopObsidianGesturePropagation(event);
}

function stopObsidianGesturePropagation(
  event: SyntheticEvent,
): void {
  event.stopPropagation();
  event.nativeEvent.stopImmediatePropagation();
}

function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(
    () => window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH,
  );

  useEffect(() => {
    const update = (): void => {
      setCompact(window.innerWidth <= COMPACT_LAYOUT_MAX_WIDTH);
    };

    update();
    window.addEventListener("resize", update);

    return () => {
      window.removeEventListener("resize", update);
    };
  }, []);

  return compact;
}

interface LongPressHandlers {
  onPointerDownCapture: (
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onPointerMoveCapture: (
    event: ReactPointerEvent<HTMLElement>,
  ) => void;
  onPointerUpCapture: () => void;
  onPointerCancelCapture: () => void;
  onClickCapture: (event: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (event: ReactPointerEvent<HTMLElement>) => void;
}

function useLongPress(
  enabled: boolean,
  onLongPress: () => void,
): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const callback = useRef(onLongPress);

  useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);

  const clearTimer = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    startPoint.current = null;
  };

  useEffect(() => clearTimer, []);

  return {
    onPointerDownCapture: (event) => {
      if (
        !enabled ||
        event.button > 0 ||
        event.isPrimary === false
      ) {
        return;
      }
      clearTimer();
      suppressClick.current = false;
      startPoint.current = {
        x: event.clientX,
        y: event.clientY,
      };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        startPoint.current = null;
        suppressClick.current = true;
        callback.current();
      }, LONG_PRESS_DELAY_MS);
    },
    onPointerMoveCapture: (event) => {
      const start = startPoint.current;
      if (
        start &&
        Math.hypot(
          event.clientX - start.x,
          event.clientY - start.y,
        ) > LONG_PRESS_MOVE_TOLERANCE
      ) {
        clearTimer();
      }
    },
    onPointerUpCapture: clearTimer,
    onPointerCancelCapture: clearTimer,
    onClickCapture: (event) => {
      if (!suppressClick.current) {
        return;
      }
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu: (event) => {
      if (enabled) {
        event.preventDefault();
      }
    },
  };
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
