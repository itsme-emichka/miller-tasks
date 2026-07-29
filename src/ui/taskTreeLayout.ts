import { TaskRecord } from "../domain/task";

export const TASK_TREE_NODE_WIDTH = 208;
export const TASK_TREE_NODE_HEIGHT = 38;
export const TASK_TREE_HORIZONTAL_GAP = 36;
export const TASK_TREE_VERTICAL_GAP = 72;
export const TASK_TREE_PADDING = 32;

export interface TaskTreeLayoutNode {
  task: TaskRecord;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TaskTreeLayoutEdge {
  parentId: string;
  childId: string;
  parentX: number;
  parentY: number;
  childX: number;
  childY: number;
}

export interface TaskTreeLayout {
  nodes: TaskTreeLayoutNode[];
  edges: TaskTreeLayoutEdge[];
  width: number;
  height: number;
}

export function layoutTaskTree(
  tasks: readonly TaskRecord[],
): TaskTreeLayout {
  const treeTasks = tasks.filter(
    (task) => task.dailyTemplateId === null,
  );
  if (treeTasks.length === 0) {
    return { nodes: [], edges: [], width: 0, height: 0 };
  }

  const childrenByParent = new Map<string | null, TaskRecord[]>();
  for (const task of treeTasks) {
    const siblings = childrenByParent.get(task.parentId) ?? [];
    siblings.push(task);
    childrenByParent.set(task.parentId, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => left.order - right.order);
  }

  let nextLeafCenter =
    TASK_TREE_PADDING + TASK_TREE_NODE_WIDTH / 2;
  const nodes: TaskTreeLayoutNode[] = [];
  const nodeById = new Map<string, TaskTreeLayoutNode>();

  const visit = (
    task: TaskRecord,
    depth: number,
  ): TaskTreeLayoutNode => {
    const children = childrenByParent.get(task.id) ?? [];
    const childNodes = children.map((child) =>
      visit(child, depth + 1),
    );
    const centerX =
      childNodes.length === 0
        ? nextLeafCenter
        : ((childNodes[0]?.x ?? 0) +
            TASK_TREE_NODE_WIDTH / 2 +
            (childNodes.at(-1)?.x ?? 0) +
            TASK_TREE_NODE_WIDTH / 2) /
          2;
    if (childNodes.length === 0) {
      nextLeafCenter +=
        TASK_TREE_NODE_WIDTH + TASK_TREE_HORIZONTAL_GAP;
    }

    const node: TaskTreeLayoutNode = {
      task,
      depth,
      x: centerX - TASK_TREE_NODE_WIDTH / 2,
      y:
        TASK_TREE_PADDING +
        depth * (TASK_TREE_NODE_HEIGHT + TASK_TREE_VERTICAL_GAP),
      width: TASK_TREE_NODE_WIDTH,
      height: TASK_TREE_NODE_HEIGHT,
    };
    nodes.push(node);
    nodeById.set(task.id, node);
    return node;
  };

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0);
  }

  const edges: TaskTreeLayoutEdge[] = [];
  for (const node of nodes) {
    if (node.task.parentId === null) {
      continue;
    }
    const parent = nodeById.get(node.task.parentId);
    if (!parent) {
      continue;
    }
    edges.push({
      parentId: parent.task.id,
      childId: node.task.id,
      parentX: parent.x + parent.width / 2,
      parentY: parent.y + parent.height,
      childX: node.x + node.width / 2,
      childY: node.y,
    });
  }

  return {
    nodes,
    edges,
    width:
      Math.max(...nodes.map((node) => node.x + node.width)) +
      TASK_TREE_PADDING,
    height:
      Math.max(...nodes.map((node) => node.y + node.height)) +
      TASK_TREE_PADDING,
  };
}
