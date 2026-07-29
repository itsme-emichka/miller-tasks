import { describe, expect, it } from "vitest";

import {
  createInitialPositionKey,
  generatePositionKeyBetween,
  validatePositionKey,
} from "./positionKey";

describe("stable position keys", () => {
  it("preserves migrated integer order lexicographically", () => {
    const keys = [0, 1, 2, 35, 36, 1_000].map(
      createInitialPositionKey,
    );

    expect([...keys].sort()).toEqual(keys);
    keys.forEach((key) => expect(() => validatePositionKey(key)).not.toThrow());
  });

  it("creates keys before, between, and after existing siblings", () => {
    const first = createInitialPositionKey(0);
    const second = createInitialPositionKey(1);
    const before = generatePositionKeyBetween(null, first);
    const between = generatePositionKeyBetween(first, second);
    const after = generatePositionKeyBetween(second, null);

    expect(before < first).toBe(true);
    expect(first < between && between < second).toBe(true);
    expect(second < after).toBe(true);
  });

  it("supports repeated insertion at either boundary", () => {
    let first = createInitialPositionKey(0);
    let last = first;

    for (let index = 0; index < 200; index += 1) {
      const before = generatePositionKeyBetween(null, first);
      const after = generatePositionKeyBetween(last, null);
      expect(before < first).toBe(true);
      expect(last < after).toBe(true);
      first = before;
      last = after;
    }
  });

  it("rejects invalid or reversed boundaries", () => {
    expect(() => generatePositionKeyBetween("z", "A")).toThrow(
      "ascending",
    );
    expect(() => validatePositionKey("bad-")).toThrow("Invalid");
    expect(() => validatePositionKey("U0")).toThrow("Invalid");
  });
});
