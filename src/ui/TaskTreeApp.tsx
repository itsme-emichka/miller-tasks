import { useEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";

import { isTaskOverdue } from "../domain/due";
import { TaskStore } from "../domain/TaskStore";
import { PluginData, TaskRecord } from "../domain/task";
import { TaskSelection } from "../state/TaskSelection";
import {
  layoutTaskTree,
  TaskTreeLayoutEdge,
} from "./taskTreeLayout";
import { MillerViewHeader } from "./MillerViewHeader";

interface TaskTreeAppProps {
  store: TaskStore;
  selection: TaskSelection;
  onToggleView?: () => void;
  onTaskSelected?: (taskId: string) => void;
  onTaskCompletion?: (taskId: string, completed: boolean) => void;
  onTaskDelete?: (taskId: string) => void;
}

const MIN_TREE_ZOOM = 0.02;
const MAX_TREE_ZOOM = 2;
const TREE_ZOOM_STEP = 0.1;
const TREE_FIT_PADDING = 24;

export function TaskTreeApp({
  store,
  selection,
  onToggleView,
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
  const viewportElement = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const hasTasks = layout.nodes.length > 0;

  useEffect(() => {
    const viewport = viewportElement.current;
    if (!viewport) {
      return;
    }

    const handleWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      setZoom((current) =>
        clampZoom(current + direction * TREE_ZOOM_STEP),
      );
    };

    viewport.addEventListener("wheel", handleWheel, {
      passive: false,
    });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, []);

  const selectTask = (taskId: string): void => {
    selection.setSelectedTaskId(taskId);
    onTaskSelected?.(taskId);
  };

  const fitTree = (): void => {
    const viewport = viewportElement.current;
    if (
      !viewport ||
      !hasTasks ||
      viewport.clientWidth <= 0 ||
      viewport.clientHeight <= 0
    ) {
      return;
    }

    const availableWidth = Math.max(
      1,
      viewport.clientWidth - TREE_FIT_PADDING * 2,
    );
    const availableHeight = Math.max(
      1,
      viewport.clientHeight - TREE_FIT_PADDING * 2,
    );
    setZoom(
      clampZoom(
        Math.min(
          1,
          availableWidth / layout.width,
          availableHeight / layout.height,
        ),
      ),
    );
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  };

  return (
    <main className="miller-task-tree-shell">
      <MillerViewHeader
        mode="tree"
        onToggleView={onToggleView}
        controls={
          <TreeZoomControls
            zoom={zoom}
            disabled={!hasTasks}
            onZoomOut={() =>
              setZoom((current) =>
                clampZoom(current - TREE_ZOOM_STEP),
              )
            }
            onReset={() => setZoom(1)}
            onZoomIn={() =>
              setZoom((current) =>
                clampZoom(current + TREE_ZOOM_STEP),
              )
            }
            onFit={fitTree}
          />
        }
      />
      <div
        ref={viewportElement}
        className="miller-task-tree-viewport"
        role="region"
        aria-label="Task tree"
      >
        {!hasTasks ? (
          <p className="miller-task-tree-empty">No tasks</p>
        ) : (
          <div
            className="miller-task-tree-zoom-surface"
            style={{
              width: layout.width * zoom,
              height: layout.height * zoom,
            }}
          >
            <div
              className="miller-task-tree-canvas"
              style={{
                width: layout.width,
                height: layout.height,
                transform: `scale(${zoom})`,
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
          </div>
        )}
      </div>
    </main>
  );
}

interface TreeZoomControlsProps {
  zoom: number;
  disabled: boolean;
  onZoomOut: () => void;
  onReset: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}

function TreeZoomControls({
  zoom,
  disabled,
  onZoomOut,
  onReset,
  onZoomIn,
  onFit,
}: TreeZoomControlsProps): JSX.Element {
  return (
    <div
      className="miller-task-tree-zoom-controls"
      aria-label="Tree zoom controls"
    >
      <button
        type="button"
        aria-label="Zoom out"
        title="Zoom out"
        disabled={disabled || zoom <= MIN_TREE_ZOOM}
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        className="miller-task-tree-zoom-value"
        type="button"
        aria-label="Reset tree zoom"
        title="Reset to 100%"
        disabled={disabled}
        onClick={onReset}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        aria-label="Zoom in"
        title="Zoom in"
        disabled={disabled || zoom >= MAX_TREE_ZOOM}
        onClick={onZoomIn}
      >
        +
      </button>
      <button
        className="miller-task-tree-fit"
        type="button"
        disabled={disabled}
        onClick={onFit}
      >
        Fit
      </button>
    </div>
  );
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_TREE_ZOOM, Math.max(MIN_TREE_ZOOM, zoom));
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
