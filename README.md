# Miller Tasks

Miller Tasks is a desktop task tracker for Obsidian. It turns one recursive
task tree into horizontally scrolling Miller columns and keeps task details in
Obsidian's native, collapsible right sidebar.

The design is deliberately minimal: one shared heading, an always-pinned Today
column, unlabelled hierarchy columns, and the same background as the active
Obsidian theme.

> Beta status: the first complete prototype is ready for testing. The data
> format is versioned, but compatibility is not guaranteed before 1.0.

## Features

- Navigate and reorganize a task tree up to 10 levels deep.
- Render every task as a plain Obsidian checkbox-and-text line.
- Add any tree task to the pinned Today column from its row calendar icon.
- Keep unfinished Today tasks across days and completed ones for 24 hours.
- Define daily tasks that receive one fresh incomplete instance each local
  day.
- Create tasks and subtasks directly at the end of each visible column.
- Rename inline and complete tasks. A completed tree row stays struck through
  for the rest of its local day; older completions are hidden by default.
- Keep description, tags, local due date/time, priority, flag, and an absolute
  HTTP/HTTPS URL in the native right-sidebar inspector.
- Highlight incomplete overdue tasks with Obsidian's error color.
- Reorder siblings and move subtrees with pointer or keyboard drag-and-drop.
- Paste or drop multiple images, open their previews, and remove them through
  Obsidian's trash.
- Confirm cascade completion, task deletion, and image removal.
- Preserve the selected path after valid moves and reloads.

Miller Tasks is desktop-only and requires Obsidian 1.8.0 or newer.

## Install the beta from source

Requirements:

- Node.js 22 or newer
- npm

```bash
git clone https://github.com/itsme-emichka/miller-tasks.git
cd miller-tasks
npm ci
npm run build
```

Create `.obsidian/plugins/miller-tasks/` inside the target vault and copy these
files into it:

```text
main.js
manifest.json
styles.css
```

Restart Obsidian, then enable **Miller Tasks** under **Settings → Community
plugins**.

## Use

- Open the browser from the ribbon tree icon or run **Miller Tasks: Open task
  browser** from the command palette.
- Type into **New task** and press Enter. Selecting the new row opens its
  subtask column.
- Click a row to select it. Double-click it, or press F2, to rename it.
- Press Delete or Backspace on a selected row to remove it immediately when
  it has no subtasks. A task with subtasks asks before deleting the subtree.
- Click the calendar-plus icon at the end of a tree row to add or remove that
  task from Today. The pinned copy is the same task, so its checkbox and
  metadata stay synchronized.
- Use Arrow Up/Down, Home, and End to move between siblings. Arrow Right enters
  the next column; Arrow Left returns to the parent.
- Drag within a column to reorder. Drop onto a row in another column to make a
  task its child; drop near an edge to insert beside it.
- Edit metadata in the right sidebar. Text saves after 400 ms and immediately
  on blur or task change.
- Create and rename daily tasks in the **Daily tasks** section of the right
  sidebar. Deleting a daily task asks for confirmation.
- Paste images while the inspector is active, or drop them on the Images area.
- Run **Miller Tasks: Toggle completed tasks** to show or hide completed work.
- Run **Miller Tasks: Delete selected task** to delete the selected subtree
  after confirmation.
- Use **Delete task** in the right-sidebar inspector for the same behavior
  without returning focus to the task row.

Completing a parent completes its full subtree after confirmation. Reopening a
completed parent reopens only that parent. A completed ordinary Today task
remains struck through for 24 hours. At local midnight, every daily-task
instance is removed and replaced with a new incomplete instance; an unfinished
ordinary Today task carries forward. In the hierarchy itself, a newly
completed row remains visible and struck through until the next local day.

## Data and files

Task records are stored by Obsidian through the plugin data API in:

```text
.obsidian/plugins/miller-tasks/data.json
```

Images are copied into the vault:

```text
Miller Tasks/Attachments/<task-id>/
```

Removing an image or deleting its owning task moves recorded files through
Obsidian's configured trash behavior. If a file cannot be moved to trash, its
record is retained and task deletion is aborted.

Due dates and times are local strings. The plugin does not convert time zones.
Today and daily rollover also use the computer's local calendar date. The
rollover runs on plugin load and once per minute while Obsidian is open.

## Scope

The beta intentionally excludes general recurrence rules, reminders,
notifications, time zones, smart lists, multiple lists, search, arbitrary
custom properties, and mobile UI. Daily tasks are the only automatic
re-creation rule.

## Develop

```bash
npm ci
npm run check
npm run dev:vault
```

`npm run check` runs lint, Vitest, TypeScript, and the production bundle.
`npm run dev:vault` installs `main.js`, `manifest.json`, and `styles.css` into
the ignored local `dev-vault`.

Use a different development vault with:

```bash
MILLER_TASKS_VAULT=/absolute/path/to/vault npm run dev:vault
```

Project documentation:

- [`PLAN.md`](PLAN.md) tracks implementation checkpoints and acceptance.
- [`PROJECT_MEMORY.md`](PROJECT_MEMORY.md) records architecture, invariants,
  verification, known issues, and the exact resume point.

## License

Miller Tasks is licensed under the GNU General Public License v3.0 only.
