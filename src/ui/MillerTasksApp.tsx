import type { JSX } from "react";

export function MillerTasksApp(): JSX.Element {
  return (
    <main className="miller-tasks-shell">
      <h1>Miller Tasks</h1>
      <div
        className="miller-tasks-columns"
        aria-label="Task hierarchy columns"
      >
        <section
          className="miller-tasks-column"
          aria-label="Root tasks"
        />
        <section
          className="miller-tasks-column"
          aria-label="Subtasks"
        />
      </div>
    </main>
  );
}
