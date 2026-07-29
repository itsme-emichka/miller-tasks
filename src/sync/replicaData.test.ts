import { describe, expect, it } from "vitest";

import { TaskStore } from "../domain/TaskStore";
import { createDefaultPluginDataV3 } from "./syncData";
import {
  createReplicaDocument,
  mergeReplicaDocuments,
  parseReplicaDocument,
  parseReplicaDocumentText,
  serializeReplicaDocument,
} from "./replicaData";

describe("replicaData", () => {
  it("round-trips one canonical envelope and validates its vector", () => {
    const store = createStore("mac", ["task-1"]);
    store.createTask({ title: "Local" });
    const document = createReplicaDocument(
      "mac",
      1,
      {},
      store.getSyncSnapshot(),
    );

    expect(
      parseReplicaDocumentText(serializeReplicaDocument(document)),
    ).toEqual(document);
    expect(document.observed).toEqual({ mac: 1, migration: 0 });
    expect(() =>
      parseReplicaDocument({
        ...document,
        observed: {},
      }),
    ).toThrow(/behind state actor/i);
  });

  it("retains independent offline tasks from two replicas", () => {
    const mac = createStore("mac", ["mac-task"]);
    const phone = createStore("phone", ["phone-task"]);
    mac.createTask({ title: "From Mac" });
    phone.createTask({ title: "From phone" });

    const merged = mergeReplicaDocuments([
      createReplicaDocument("phone", 1, {}, phone.getSyncSnapshot()),
      createReplicaDocument("mac", 1, {}, mac.getSyncSnapshot()),
    ]);

    expect(merged.state.tasks.map((task) => task.title)).toEqual([
      "From Mac",
      "From phone",
    ]);
    expect(merged.state.conflicts).toEqual([]);
    expect(merged.observed).toMatchObject({
      mac: 1,
      phone: 1,
    });
  });

  it("records a conflict for concurrent same-field edits", () => {
    const baseStore = createStore("mac", ["shared-task"]);
    const task = baseStore.createTask({ title: "Original" });
    const base = baseStore.getSyncSnapshot();
    const mac = createStore("mac", [], base);
    const phone = createStore("phone", [], base);
    mac.updateTask(task.id, { title: "Mac title" });
    phone.updateTask(task.id, { title: "Phone title" });

    const merged = mergeReplicaDocuments([
      createReplicaDocument("mac", 1, {}, mac.getSyncSnapshot()),
      createReplicaDocument(
        "phone",
        1,
        {},
        phone.getSyncSnapshot(),
      ),
    ]);

    expect(merged.state.tasks[0]?.title).toBe("Phone title");
    expect(merged.state.conflicts).toHaveLength(1);
    expect(merged.state.conflicts[0]).toMatchObject({
      entityType: "task",
      entityId: task.id,
      fieldGroup: "title",
    });
  });

  it("accepts a causally later same-field edit without conflict", () => {
    const macStore = createStore("mac", ["shared-task"]);
    const task = macStore.createTask({ title: "Original" });
    macStore.updateTask(task.id, { title: "Mac title" });
    const macDocument = createReplicaDocument(
      "mac",
      1,
      {},
      macStore.getSyncSnapshot(),
    );
    const phoneStore = createStore(
      "phone",
      [],
      macDocument.state,
    );
    phoneStore.updateTask(task.id, { title: "Phone later" });
    const phoneDocument = createReplicaDocument(
      "phone",
      1,
      macDocument.observed,
      phoneStore.getSyncSnapshot(),
    );

    const merged = mergeReplicaDocuments([
      phoneDocument,
      macDocument,
    ]);

    expect(merged.state.tasks[0]?.title).toBe("Phone later");
    expect(merged.state.conflicts).toEqual([]);
    expect(merged.observed).toMatchObject({
      mac: 2,
      phone: 3,
    });
  });

  it("uses only the highest delivered generation per replica", () => {
    const store = createStore("mac", ["first", "second"]);
    store.createTask({ title: "First" });
    const first = createReplicaDocument(
      "mac",
      1,
      {},
      store.getSyncSnapshot(),
    );
    store.createTask({ title: "Second" });
    const second = createReplicaDocument(
      "mac",
      2,
      first.observed,
      store.getSyncSnapshot(),
    );

    const merged = mergeReplicaDocuments([second, first]);

    expect(merged.documents).toHaveLength(1);
    expect(merged.documents[0]?.generation).toBe(2);
    expect(merged.state.tasks.map((task) => task.title)).toEqual([
      "First",
      "Second",
    ]);
  });

  it("preserves divergent same-generation files as a conflict", () => {
    const baseStore = createStore("mac", ["shared-task"]);
    const task = baseStore.createTask({ title: "Original" });
    const base = baseStore.getSyncSnapshot();
    const leftStore = createStore("mac", [], base);
    const rightStore = createStore("mac", [], base);
    leftStore.updateTask(task.id, { title: "Left" });
    rightStore.updateTask(task.id, { title: "Right" });

    const left = createReplicaDocument(
      "mac",
      2,
      {},
      leftStore.getSyncSnapshot(),
    );
    const right = createReplicaDocument(
      "mac",
      2,
      {},
      rightStore.getSyncSnapshot(),
    );
    const merged = mergeReplicaDocuments([right, left]);

    expect(merged.documents).toHaveLength(2);
    expect(merged.state.conflicts).toHaveLength(1);
    expect(merged.state.conflicts[0]).toMatchObject({
      entityId: task.id,
      fieldGroup: "title",
    });
  });
});

function createStore(
  actorId: string,
  ids: string[],
  data = createDefaultPluginDataV3(),
): TaskStore {
  let index = 0;
  let now = 1_000;
  return new TaskStore(data, undefined, {
    actorId,
    idFactory: () => ids[index++]!,
    now: () => ++now,
  });
}
