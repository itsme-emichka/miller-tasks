import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  isTaskHistoryContext,
  isTaskViewTarget,
  isTextEditingTarget,
  resolveTaskHistoryShortcut,
} from "./taskHistoryShortcuts";

describe("task history shortcuts", () => {
  it("recognizes platform undo and redo combinations", () => {
    expect(
      resolveTaskHistoryShortcut({
        key: "z",
        altKey: false,
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
      }),
    ).toBe("undo");
    expect(
      resolveTaskHistoryShortcut({
        key: "Z",
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: true,
      }),
    ).toBe("redo");
    expect(
      resolveTaskHistoryShortcut({
        key: "y",
        altKey: false,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBe("redo");
    expect(
      resolveTaskHistoryShortcut({
        key: "z",
        altKey: true,
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
      }),
    ).toBeNull();
  });

  it("limits shortcuts to Miller Tasks views", () => {
    const { container } = render(
      <>
        <div className="miller-task-tree-view">
          <span data-task />
        </div>
        <span data-outside />
      </>,
    );
    const task = container.querySelector("[data-task]");
    const outside = container.querySelector("[data-outside]");

    expect(isTaskViewTarget(task)).toBe(true);
    expect(isTaskViewTarget(outside)).toBe(false);
    expect(isTaskHistoryContext(task, false)).toBe(true);
    expect(isTaskHistoryContext(outside, true)).toBe(false);
  });

  it("uses the active task view after a deleted row loses focus", () => {
    expect(isTaskHistoryContext(document.body, true)).toBe(true);
    expect(isTaskHistoryContext(document.documentElement, true)).toBe(
      true,
    );
    expect(isTaskHistoryContext(document, true)).toBe(true);
    expect(isTaskHistoryContext(document.body, false)).toBe(false);
  });

  it("leaves native text editing history untouched", () => {
    const { container } = render(
      <>
        <input data-text type="text" />
        <input data-checkbox type="checkbox" />
        <textarea data-textarea />
        <span data-title contentEditable />
      </>,
    );
    const text = container.querySelector("[data-text]");
    const checkbox = container.querySelector("[data-checkbox]");
    const textarea = container.querySelector("[data-textarea]");
    const title = container.querySelector("[data-title]");

    expect(isTextEditingTarget(text)).toBe(true);
    expect(isTextEditingTarget(textarea)).toBe(true);
    expect(isTextEditingTarget(title)).toBe(true);
    expect(isTextEditingTarget(checkbox)).toBe(false);
  });
});
