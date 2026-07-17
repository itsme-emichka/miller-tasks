import {
  useEffect,
  useMemo,
  useState,
} from "react";
import type {
  ClipboardEvent,
  DragEvent,
  JSX,
} from "react";

import { isTaskOverdue } from "../domain/due";
import { TaskStore } from "../domain/TaskStore";
import {
  PluginData,
  Priority,
  TaskRecord,
} from "../domain/task";
import { TaskDraftBuffer } from "../state/TaskDraftBuffer";
import { TaskSelection } from "../state/TaskSelection";
import { TaskAttachmentActions } from "./attachmentActions";

interface TaskInspectorAppProps {
  store: TaskStore;
  selection: TaskSelection;
  drafts: TaskDraftBuffer;
  attachmentActions?: TaskAttachmentActions;
}

interface TextDraft {
  description: string;
  tags: string;
  url: string;
}

export function TaskInspectorApp({
  store,
  selection,
  drafts,
  attachmentActions,
}: TaskInspectorAppProps): JSX.Element {
  const snapshot = useTaskSnapshot(store);
  const selectedTaskId = useSelectedTaskId(selection);
  const task = snapshot.tasks.find(
    (candidate) => candidate.id === selectedTaskId,
  );
  const [textDraft, setTextDraft] = useState<TextDraft>(
    createTextDraft(task),
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(
    null,
  );
  const [addingAttachments, setAddingAttachments] = useState(false);

  useEffect(() => {
    setTextDraft(createTextDraft(task));
    setUrlError(null);
    setAttachmentError(null);
  }, [task?.id, task?.updatedAt]);

  if (!task) {
    return <p className="miller-task-inspector-empty">Select a task.</p>;
  }

  const updateTextDraft = (
    field: keyof TextDraft,
    value: string,
  ): void => {
    setTextDraft((current) => ({ ...current, [field]: value }));

    if (field === "description") {
      drafts.queue(task.id, { description: value });
    } else if (field === "tags") {
      drafts.queue(task.id, { tags: value.split(",") });
    } else if (isAbsoluteHttpUrlOrEmpty(value)) {
      setUrlError(null);
      drafts.queue(task.id, { url: value });
    } else {
      setUrlError("Use an absolute http or https URL.");
    }
  };

  const flushTextDraft = (): void => {
    if (urlError === null) {
      drafts.flush(task.id);
    }
  };

  const updateImmediate = (
    update: Parameters<TaskStore["updateTask"]>[1],
  ): void => {
    drafts.flush(task.id);
    store.updateTask(task.id, update);
  };

  const addFiles = (files: readonly File[]): void => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!attachmentActions || images.length === 0) {
      return;
    }

    setAddingAttachments(true);
    setAttachmentError(null);
    void attachmentActions
      .addFiles(task.id, images)
      .catch(() => {
        setAttachmentError("Some images could not be added.");
      })
      .finally(() => setAddingAttachments(false));
  };

  const handlePaste = (event: ClipboardEvent<HTMLFormElement>): void => {
    const files = Array.from(event.clipboardData.files);
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      addFiles(files);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (
      Array.from(event.dataTransfer.items).some(
        (item) => item.kind === "file",
      )
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    addFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <form
      className="miller-task-inspector-form"
      onSubmit={(event) => event.preventDefault()}
      onPaste={handlePaste}
    >
      <p
        className="miller-task-inspector-title"
        data-overdue={isTaskOverdue(task)}
      >
        {task.title}
      </p>

      <label>
        <span>Description</span>
        <textarea
          value={textDraft.description}
          rows={6}
          onChange={(event) =>
            updateTextDraft("description", event.currentTarget.value)
          }
          onBlur={flushTextDraft}
        />
      </label>

      <label>
        <span>Tags</span>
        <input
          type="text"
          value={textDraft.tags}
          placeholder="work, next"
          onChange={(event) =>
            updateTextDraft("tags", event.currentTarget.value)
          }
          onBlur={flushTextDraft}
        />
      </label>

      <div className="miller-task-inspector-pair">
        <label>
          <span>Date</span>
          <input
            type="date"
            value={task.dueDate ?? ""}
            data-overdue={isTaskOverdue(task)}
            onChange={(event) =>
              updateImmediate({
                dueDate: event.currentTarget.value || null,
              })
            }
          />
        </label>
        <label>
          <span>Time</span>
          <input
            type="time"
            value={task.dueTime ?? ""}
            disabled={task.dueDate === null}
            onChange={(event) =>
              updateImmediate({
                dueTime: event.currentTarget.value || null,
              })
            }
          />
        </label>
      </div>

      <label>
        <span>Priority</span>
        <select
          value={task.priority}
          onChange={(event) =>
            updateImmediate({
              priority: event.currentTarget.value as Priority,
            })
          }
        >
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </label>

      <label className="miller-task-inspector-check">
        <input
          type="checkbox"
          checked={task.flagged}
          onChange={(event) =>
            updateImmediate({ flagged: event.currentTarget.checked })
          }
        />
        <span>Flagged</span>
      </label>

      <label>
        <span>URL</span>
        <input
          type="url"
          value={textDraft.url}
          aria-invalid={urlError !== null}
          aria-describedby={urlError ? "miller-task-url-error" : undefined}
          onChange={(event) =>
            updateTextDraft("url", event.currentTarget.value)
          }
          onBlur={flushTextDraft}
        />
      </label>
      {urlError ? (
        <p id="miller-task-url-error" className="miller-task-field-error">
          {urlError}
        </p>
      ) : null}

      {attachmentActions ? (
        <div className="miller-task-attachments">
          <span>Images</span>
          <div
            className="miller-task-attachment-grid"
            aria-label="Image attachments"
            aria-busy={addingAttachments}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            {task.attachments.map((attachment) => {
              const resourceUrl =
                attachmentActions.getResourceUrl(attachment);
              return (
                <div
                  className="miller-task-attachment"
                  key={attachment.id}
                >
                  <button
                    type="button"
                    className="miller-task-attachment-open"
                    aria-label={`Open ${attachment.name}`}
                    onClick={() => {
                      setAttachmentError(null);
                      void attachmentActions
                        .openAttachment(attachment)
                        .catch(() =>
                          setAttachmentError(
                            "The image could not be opened.",
                          ),
                        );
                    }}
                  >
                    {resourceUrl ? (
                      <img
                        src={resourceUrl}
                        alt={attachment.name}
                        loading="lazy"
                      />
                    ) : (
                      <span>Missing image</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="miller-task-attachment-remove"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => {
                      setAttachmentError(null);
                      void attachmentActions
                        .removeAttachment(task.id, attachment)
                        .catch(() =>
                          setAttachmentError(
                            "The image could not be removed.",
                          ),
                        );
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            {task.attachments.length === 0 ? (
              <p>Paste or drop images</p>
            ) : null}
          </div>
          {attachmentError ? (
            <p className="miller-task-field-error">
              {attachmentError}
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function createTextDraft(task: TaskRecord | undefined): TextDraft {
  return {
    description: task?.description ?? "",
    tags: task?.tags.join(", ") ?? "",
    url: task?.url ?? "",
  };
}

function isAbsoluteHttpUrlOrEmpty(value: string): boolean {
  if (value.trim() === "") {
    return true;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
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
