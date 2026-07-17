import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  JSX,
  KeyboardEvent,
  SyntheticEvent,
} from "react";

import { TaskStore } from "../domain/TaskStore";
import { MAX_TASK_DEPTH, PluginData, TaskRecord } from "../domain/task";

interface MillerTasksAppProps {
  store: TaskStore;
  onTaskSelected?: (taskId: string | null) => void;
}

interface ColumnState {
  depth: number;
  parentId: string | null;
  selectedId: string | null;
}

export function MillerTasksApp({
  store,
  onTaskSelected,
}: MillerTasksAppProps): JSX.Element {
  const snapshot = useTaskSnapshot(store);
  const [selectedPath, setSelectedPath] = useState<string[]>([]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setSelectedPath((currentPath) =>
      validateSelectedPath(currentPath, snapshot),
    );
  }, [snapshot]);

  const columns = useMemo(
    () => buildColumns(selectedPath),
    [selectedPath],
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

  return (
    <main className="miller-tasks-shell">
      <h1>Miller Tasks</h1>
      <div
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
            store={store}
          />
        ))}
      </div>
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
  store,
}: TaskColumnProps): JSX.Element {
  return (
    <section
      className="miller-tasks-column"
      aria-label={`Task level ${column.depth}`}
    >
      <div className="miller-tasks-list">
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            selected={column.selectedId === task.id}
            editing={editingTaskId === task.id}
            onBeginEditing={() => onBeginEditing(task.id)}
            onFinishEditing={onFinishEditing}
            onSelect={() => onSelectTask(task.id, columnIndex)}
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
    </section>
  );
}

interface TaskRowProps {
  task: TaskRecord;
  selected: boolean;
  editing: boolean;
  onBeginEditing: () => void;
  onFinishEditing: () => void;
  onSelect: () => void;
  store: TaskStore;
}

function TaskRow({
  task,
  selected,
  editing,
  onBeginEditing,
  onFinishEditing,
  onSelect,
  store,
}: TaskRowProps): JSX.Element {
  const [draftTitle, setDraftTitle] = useState(task.title);

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

  return (
    <div
      className="miller-task-row"
      data-selected={selected}
      data-completed={task.completed}
    >
      <input
        className="miller-task-checkbox"
        type="checkbox"
        checked={task.completed}
        aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
        onChange={(event) =>
          store.completeSubtree(task.id, event.currentTarget.checked)
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

function validateSelectedPath(
  selectedPath: readonly string[],
  snapshot: PluginData,
): string[] {
  const validPath: string[] = [];
  let expectedParentId: string | null = null;

  for (const taskId of selectedPath) {
    const task = snapshot.tasks.find(
      (candidate) => candidate.id === taskId,
    );
    if (
      !task ||
      task.parentId !== expectedParentId ||
      (!snapshot.showCompleted && task.completed)
    ) {
      break;
    }
    validPath.push(taskId);
    expectedParentId = taskId;
  }

  if (
    validPath.length === selectedPath.length &&
    validPath.every((id, index) => id === selectedPath[index])
  ) {
    return selectedPath as string[];
  }
  return validPath;
}
