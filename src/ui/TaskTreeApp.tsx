import { useEffect, useMemo, useState } from "react";
import type { JSX, KeyboardEvent } from "react";

import { isTaskOverdue } from "../domain/due";
import { TaskStore } from "../domain/TaskStore";
import { PluginData, TaskRecord } from "../domain/task";
import { TaskSelection } from "../state/TaskSelection";
import {
  layoutTaskTree,
  TaskTreeLayoutEdge,
} from "./taskTreeLayout";

interface TaskTreeAppProps {
  store: TaskStore;
  selection: TaskSelection;
  onTaskSelected?: (taskId: string) => void;
  onTaskCompletion?: (taskId: string, completed: boolean) => void;
  onTaskDelete?: (taskId: string) => void;
}

export function TaskTreeApp({
  store,
  selection,
  onTaskSelected,
  onTaskCompletion,
  onTaskDelete,
}: TaskTreeAppProps): JSX.Element {
  const snapshot = useTaskSnapshot(store);
  const selectedTaskId = useSelectedTaskId(selection);
  const layout = useMemo(
    () => layoutTaskTree(snapshot.tasks),
    [snapshot],
  );

  const selectTask = (taskId: string): void => {
    selection.setSelectedTaskId(taskId);
    onTaskSelected?.(taskId);
  };

  return (
    <main className="miller-task-tree-shell">
      <h1>Miller Tasks</h1>
      <div
        className="miller-task-tree-viewport"
        aria-label="Task tree"
      >
        {layout.nodes.length === 0 ? (
          <p className="miller-task-tree-empty">No tasks</p>
        ) : (
          <div
            className="miller-task-tree-canvas"
            style={{
              width: layout.width,
              height: layout.height,
            }}
          >
            <svg
              className="miller-task-tree-edges"
              width={layout.width}
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              aria-hidden="true"
            >
              {layout.edges.map((edge) => (
                <path
                  key={`${edge.parentId}:${edge.childId}`}
                  d={createEdgePath(edge)}
                />
              ))}
            </svg>
            {layout.nodes.map((node) => (
              <TreeTaskNode
                key={node.task.id}
                task={node.task}
                selected={selectedTaskId === node.task.id}
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                onSelect={() => selectTask(node.task.id)}
                onCompletion={(completed) =>
                  onTaskCompletion?.(node.task.id, completed)
                }
                onDelete={() => onTaskDelete?.(node.task.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

interface TreeTaskNodeProps {
  task: TaskRecord;
  selected: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  onSelect: () => void;
  onCompletion: (completed: boolean) => void;
  onDelete: () => void;
}

function TreeTaskNode({
  task,
  selected,
  x,
  y,
  width,
  height,
  onSelect,
  onCompletion,
  onDelete,
}: TreeTaskNodeProps): JSX.Element {
  const handleKeyDown = (
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
      className="miller-task-tree-node"
      data-selected={selected}
      data-completed={task.completed}
      data-overdue={isTaskOverdue(task)}
      data-task-id={task.id}
      style={{ left: x, top: y, width, height }}
    >
      <input
        className="task-list-item-checkbox miller-task-checkbox"
        type="checkbox"
        checked={task.completed}
        aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`}
        onChange={(event) =>
          onCompletion(event.currentTarget.checked)
        }
      />
      <span
        className="miller-task-tree-title"
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.currentTarget.focus({ preventScroll: true });
          onSelect();
        }}
        onKeyDown={handleKeyDown}
      >
        {task.title}
      </span>
    </div>
  );
}

function createEdgePath(edge: TaskTreeLayoutEdge): string {
  const middleY = (edge.parentY + edge.childY) / 2;
  return [
    `M ${edge.parentX} ${edge.parentY}`,
    `V ${middleY}`,
    `H ${edge.childX}`,
    `V ${edge.childY}`,
  ].join(" ");
}

function useTaskSnapshot(store: TaskStore): PluginData {
  const [revision, setRevision] = useState(0);

  useEffect(
    () => store.subscribe(() => setRevision((current) => current + 1)),
    [store],
  );

  return useMemo(() => store.getSnapshot(), [revision, store]);
}

function useSelectedTaskId(selection: TaskSelection): string | null {
  const [revision, setRevision] = useState(0);

  useEffect(
    () =>
      selection.subscribe(() =>
        setRevision((current) => current + 1),
      ),
    [selection],
  );

  return useMemo(
    () => selection.getSelectedTaskId(),
    [revision, selection],
  );
}
