import type { JSX } from "react";

const plannedFields = [
  "Description",
  "Tags",
  "Due date",
  "Priority",
  "Attachments",
];

export function MillerTasksApp(): JSX.Element {
  return (
    <main className="miller-tasks-shell">
      <header className="miller-tasks-toolbar">
        <div className="miller-tasks-title-group">
          <span className="miller-tasks-kicker">Task browser</span>
          <h1>Miller Tasks</h1>
        </div>
        <div className="miller-tasks-status" aria-label="Project status">
          <span className="miller-tasks-status-dot" aria-hidden="true" />
          Foundation ready
        </div>
      </header>

      <div className="miller-tasks-path" aria-label="Current task path">
        <span className="miller-tasks-path-origin" aria-hidden="true" />
        <span>All tasks</span>
        <span className="miller-tasks-path-line" aria-hidden="true" />
        <span className="miller-tasks-path-future">Choose a task</span>
      </div>

      <div className="miller-tasks-workspace">
        <div
          className="miller-tasks-columns"
          aria-label="Task hierarchy columns"
        >
          <section
            className="miller-tasks-column miller-tasks-column-active"
            aria-labelledby="root-column-heading"
          >
            <header className="miller-tasks-column-header">
              <div>
                <span className="miller-tasks-level">Level 1</span>
                <h2 id="root-column-heading">Tasks</h2>
              </div>
              <span className="miller-tasks-count">0</span>
            </header>

            <div className="miller-tasks-empty-state">
              <div className="miller-tasks-lineage-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h3>Your task tree starts here</h3>
              <p>
                The foundation is installed. Task creation arrives in the
                navigation checkpoint.
              </p>
            </div>
          </section>

          <section
            className="miller-tasks-column miller-tasks-column-preview"
            aria-labelledby="child-column-heading"
          >
            <header className="miller-tasks-column-header">
              <div>
                <span className="miller-tasks-level">Level 2</span>
                <h2 id="child-column-heading">Subtasks</h2>
              </div>
            </header>

            <div className="miller-tasks-column-hint">
              <span className="miller-tasks-hint-arrow" aria-hidden="true">
                →
              </span>
              <p>Select a task to open its next level.</p>
            </div>
          </section>
        </div>

        <aside
          className="miller-tasks-inspector"
          aria-labelledby="inspector-heading"
        >
          <header className="miller-tasks-inspector-header">
            <span className="miller-tasks-level">Inspector</span>
            <h2 id="inspector-heading">Task details</h2>
          </header>

          <div className="miller-tasks-inspector-empty">
            <div className="miller-tasks-inspector-glyph" aria-hidden="true">
              <span />
            </div>
            <h3>Nothing selected</h3>
            <p>Choose a task to edit its details without leaving the tree.</p>
            <ul aria-label="Planned task fields">
              {plannedFields.map((field) => (
                <li key={field}>{field}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
