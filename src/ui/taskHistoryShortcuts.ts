export type TaskHistoryShortcut = "undo" | "redo";

interface HistoryKeyboardEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const TASK_VIEW_SELECTOR = [
  ".miller-tasks-view",
  ".miller-task-tree-view",
  ".miller-task-inspector-view",
].join(", ");

const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export function resolveTaskHistoryShortcut(
  event: HistoryKeyboardEvent,
): TaskHistoryShortcut | null {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key === "z") {
    return event.shiftKey ? "redo" : "undo";
  }
  if (key === "y" && !event.shiftKey) {
    return "redo";
  }
  return null;
}

export function isTaskViewTarget(target: EventTarget | null): boolean {
  const element = getElementTarget(target);
  return (
    element !== null &&
    element.closest(TASK_VIEW_SELECTOR) !== null
  );
}

export function isTaskHistoryContext(
  target: EventTarget | null,
  hasActiveTaskView: boolean,
): boolean {
  if (isTaskViewTarget(target)) {
    return true;
  }
  if (!hasActiveTaskView) {
    return false;
  }

  const element = getElementTarget(target);
  if (element) {
    const tagName = element.tagName.toLowerCase();
    return tagName === "body" || tagName === "html";
  }
  return (
    target !== null &&
    typeof target === "object" &&
    (target as { nodeType?: unknown }).nodeType ===
      Node.DOCUMENT_NODE
  );
}

export function isTextEditingTarget(
  target: EventTarget | null,
): boolean {
  const element = getElementTarget(target);
  if (!element) {
    return false;
  }
  const contentEditable = element.closest<HTMLElement>(
    "[contenteditable]",
  );
  if (
    element.isContentEditable ||
    (contentEditable !== null &&
      contentEditable.getAttribute("contenteditable") !== "false")
  ) {
    return true;
  }
  const tagName = element.tagName.toLowerCase();
  if (tagName === "textarea" || tagName === "select") {
    return true;
  }
  return (
    tagName === "input" &&
    !NON_TEXT_INPUT_TYPES.has(
      element.getAttribute("type")?.toLowerCase() ?? "text",
    )
  );
}

function getElementTarget(
  target: EventTarget | null,
): HTMLElement | null {
  if (target === null || typeof target !== "object") {
    return null;
  }
  const candidate = target as {
    closest?: unknown;
    tagName?: unknown;
  };
  if (
    typeof candidate.closest !== "function" ||
    typeof candidate.tagName !== "string"
  ) {
    return null;
  }
  return target as HTMLElement;
}
