import { useEffect, useState } from "react";
import type {
  JSX,
  KeyboardEvent,
  SyntheticEvent,
} from "react";

import { TaskStore } from "../domain/TaskStore";
import { DailyTaskTemplate } from "../domain/task";
import { DailyTemplateActions } from "./dailyTemplateActions";

interface DailyTasksEditorProps {
  store: TaskStore;
  templates: readonly DailyTaskTemplate[];
  actions?: DailyTemplateActions;
}

export function DailyTasksEditor({
  store,
  templates,
  actions,
}: DailyTasksEditorProps): JSX.Element {
  const [newTitle, setNewTitle] = useState("");

  const createTemplate = (
    event: SyntheticEvent<HTMLFormElement>,
  ): void => {
    event.preventDefault();
    if (newTitle.trim() === "") {
      return;
    }
    store.createDailyTemplate(newTitle);
    setNewTitle("");
  };

  return (
    <section
      className="miller-daily-templates"
      aria-label="Daily tasks"
    >
      <p className="miller-daily-templates-label">Daily tasks</p>
      <div className="miller-daily-template-list">
        {templates.map((template) => (
          <DailyTemplateRow
            key={template.id}
            template={template}
            store={store}
            onDelete={() => {
              if (actions) {
                void actions.deleteTemplate(
                  template.id,
                  template.title,
                );
              } else {
                store.deleteDailyTemplate(template.id);
              }
            }}
          />
        ))}
      </div>
      <form
        className="miller-new-daily-template"
        onSubmit={createTemplate}
      >
        <input
          type="text"
          value={newTitle}
          aria-label="New daily task"
          placeholder="Add daily task"
          onChange={(event) => setNewTitle(event.currentTarget.value)}
        />
        <button type="submit" aria-label="Add daily task">
          +
        </button>
      </form>
    </section>
  );
}

interface DailyTemplateRowProps {
  template: DailyTaskTemplate;
  store: TaskStore;
  onDelete: () => void;
}

function DailyTemplateRow({
  template,
  store,
  onDelete,
}: DailyTemplateRowProps): JSX.Element {
  const [draftTitle, setDraftTitle] = useState(template.title);

  useEffect(() => {
    setDraftTitle(template.title);
  }, [template.title]);

  const saveTitle = (): void => {
    if (draftTitle.trim() === "") {
      setDraftTitle(template.title);
      return;
    }
    if (draftTitle.trim() !== template.title) {
      store.updateDailyTemplate(template.id, draftTitle);
    }
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraftTitle(template.title);
      event.currentTarget.blur();
    }
  };

  return (
    <div className="miller-daily-template-row">
      <input
        type="text"
        value={draftTitle}
        aria-label={`Daily task ${template.title}`}
        onChange={(event) => setDraftTitle(event.currentTarget.value)}
        onBlur={saveTitle}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        aria-label={`Delete daily task ${template.title}`}
        onClick={onDelete}
      >
        ×
      </button>
    </div>
  );
}
