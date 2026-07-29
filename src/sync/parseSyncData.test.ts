import { describe, expect, it } from "vitest";

import { TaskDomainError } from "../domain/task";
import {
  parseOrMigratePluginDataV3,
  parsePluginDataV3,
} from "./parseSyncData";
import {
  clonePluginDataV3,
  migratePluginDataToV3,
} from "./syncData";

describe("schema-v3 parsing", () => {
  it("parses canonical schema v3 and returns a defensive copy", () => {
    const source = migratePluginDataToV3(null);
    const parsed = parsePluginDataV3(source);
    parsed.showCompleted = true;

    expect(source.showCompleted).toBe(false);
    expect(parsed.schemaVersion).toBe(3);
  });

  it("routes legacy data through deterministic migration", () => {
    expect(parseOrMigratePluginDataV3(null)).toEqual(
      migratePluginDataToV3(null),
    );
  });

  it("rejects invalid stamps, clocks, positions, and duplicates", () => {
    const invalidStamp = migratePluginDataToV3(null);
    invalidStamp.showCompletedVersion.actorId = "";
    expectDataError(() => parsePluginDataV3(invalidStamp));

    const invalidClock = migratePluginDataToV3(null);
    invalidClock.showCompletedVersion = {
      counter: 2,
      actorId: "device",
    };
    expectDataError(() => parsePluginDataV3(invalidClock));

    const duplicate = migratePluginDataToV3({
      schemaVersion: 2,
      showCompleted: false,
      tasks: [],
      dailyTemplates: [],
    });
    const copy = clonePluginDataV3(duplicate);
    copy.conflicts.push({
      id: "same",
      entityType: "plugin",
      entityId: "miller-tasks",
      fieldGroup: "showCompleted",
      leftValue: false,
      rightValue: true,
      winner: { counter: 0, actorId: "migration" },
      detected: { counter: 0, actorId: "migration" },
    });
    copy.conflicts.push({ ...copy.conflicts[0]! });
    expectDataError(() => parsePluginDataV3(copy));
  });
});

function expectDataError(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(TaskDomainError);
    expect((error as TaskDomainError).code).toBe("data-invalid");
    return;
  }
  throw new Error("Expected invalid schema-v3 data.");
}
