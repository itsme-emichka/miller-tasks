import { describe, expect, it } from "vitest";

import { createDefaultPluginData } from "../domain/pluginData";
import { TaskStore } from "../domain/TaskStore";
import {
  layoutTaskTree,
  TASK_TREE_HORIZONTAL_GAP,
} from "./taskTreeLayout";

function createStore(): TaskStore {
  let id = 0;
  return new TaskStore(createDefaultPluginData(), undefined, {
    idFactory: () => `tree-${++id}`,
    now: () => 1,
  });
}

describe("layoutTaskTree", () => {
  it("places parents above children and centers branches", () => {
    const store = createStore();
    const root = store.createTask({ title: "Root" });
    const left = store.createTask({
      parentId: root.id,
      title: "Left",
    });
    const right = store.createTask({
      parentId: root.id,
      title: "Right",
    });
    const nested = store.createTask({
      parentId: left.id,
      title: "Nested",
    });

    const layout = layoutTaskTree(store.getSnapshot().tasks);
    const byId = new Map(
      layout.nodes.map((node) => [node.task.id, node]),
    );
    const rootNode = byId.get(root.id)!;
    const leftNode = byId.get(left.id)!;
    const rightNode = byId.get(right.id)!;
    const nestedNode = byId.get(nested.id)!;

    expect(rootNode.y).toBeLessThan(leftNode.y);
    expect(leftNode.y).toBeLessThan(nestedNode.y);
    expect(rootNode.x + rootNode.width / 2).toBe(
      (leftNode.x +
        leftNode.width / 2 +
        rightNode.x +
        rightNode.width / 2) /
        2,
    );
    expect(layout.edges).toHaveLength(3);
  });

  it("keeps ordered leaf slots from overlapping", () => {
    const store = createStore();
    const first = store.createTask({ title: "First root" });
    const second = store.createTask({ title: "Second root" });
    const firstLeaf = store.createTask({
      parentId: first.id,
      title: "First leaf",
    });
    const secondLeaf = store.createTask({
      parentId: second.id,
      title: "Second leaf",
    });

    const layout = layoutTaskTree(store.getSnapshot().tasks);
    const byId = new Map(
      layout.nodes.map((node) => [node.task.id, node]),
    );
    const firstNode = byId.get(firstLeaf.id)!;
    const secondNode = byId.get(secondLeaf.id)!;

    expect(
      secondNode.x - (firstNode.x + firstNode.width),
    ).toBeGreaterThanOrEqual(TASK_TREE_HORIZONTAL_GAP);
    expect(firstNode.x).toBeLessThan(secondNode.x);
  });

  it("excludes generated daily instances from the hierarchy", () => {
    const store = createStore();
    store.createTask({ title: "Tree task" });
    store.createDailyTemplate("Daily task");

    const layout = layoutTaskTree(store.getSnapshot().tasks);

    expect(layout.nodes.map((node) => node.task.title)).toEqual([
      "Tree task",
    ]);
  });
});
