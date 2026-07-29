# Miller Tasks

Miller Tasks is a desktop and mobile task tracker for Obsidian. It turns one
recursive task tree into horizontally scrolling Miller columns. Task details
use Obsidian's native, collapsible right sidebar on desktop and a native popup
on phones. A separate structured Tree View shows the complete hierarchy from
top-level parents down to their children.

The design is deliberately minimal: one shared heading, an always-pinned Today
column, unlabelled hierarchy columns, and the same background as the active
Obsidian theme.

> Beta status: the first complete prototype is ready for testing. The data
> format is versioned, but compatibility is not guaranteed before 1.0.

## Features

- Navigate and reorganize a task tree up to 10 levels deep.
- Inspect the complete hierarchy in a deterministic top-down Tree View with
  Graph View-like connections.
- Render every task as a plain Obsidian checkbox-and-text line.
- Add any tree task to the pinned Today column from its row calendar icon.
- Show a subtask's direct parent as quiet context below its Today title.
- Keep unfinished Today tasks across days and completed ones for 24 hours.
- Sort incomplete tasks above completed tasks within both Today sections.
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
- Stack Today above the horizontal hierarchy on phones and narrow desktop
  windows while leaving the wide desktop layout unchanged.
- Hide completed Today tasks by default in compact mode and reveal them from
  one small disclosure at the bottom of the section.

Miller Tasks requires Obsidian 1.8.0 or newer. Mobile support is currently a
beta and still requires physical-device touch and attachment QA.

## Install the beta with BRAT

Miller Tasks is distributed as a GitHub beta before its Community Plugins
submission. To install it on desktop or mobile:

1. Open **Settings → Community plugins** in Obsidian and turn off Restricted
   Mode.
2. Browse the community catalog, install **Obsidian42 - BRAT**, and enable it.
3. Open the BRAT settings and select **Add beta plugin**, or run **BRAT: Add a
   beta plugin for testing** from the command palette.
4. Enter `https://github.com/itsme-emichka/miller-tasks`.
5. After BRAT downloads the release, return to **Settings → Community
   plugins** and enable **Miller Tasks**.

BRAT can install future Miller Tasks beta releases from the same repository.
Cross-device task reconciliation is not connected yet. Until it is released,
use the mobile beta with test tasks rather than expecting a Mac task database
to appear on a phone.

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
- Use the icon immediately left of **Miller Tasks** to switch the current view
  between columns and the structured hierarchy. The same Obsidian leaf stays
  open, so this does not create duplicate tabs.
- You can also run **Miller Tasks: Open task tree** directly. The canvas uses
  manual horizontal and vertical scrolling and never moves itself.
- In Tree View, use `−`, the percentage reset, `+`, or **Fit** beside the
  heading. Cmd/Ctrl+wheel also zooms; an unmodified wheel keeps its normal
  scrolling behavior. **Fit** scales the complete tree into the visible area.
- Type into **New task** and press Enter. Selecting the new row opens its
  subtask column.
- Click a row to select it. Double-click it, or press F2, to rename it.
- On a phone, tap a task to navigate its children and press and hold the task
  to open its details in a popup. The desktop right-sidebar inspector is not
  opened in compact mode.
- Compact mode is always active on phones and also activates when a desktop
  window is 720 pixels wide or narrower. Today moves above the hierarchy, and
  the visible edge of the next column indicates horizontal scrolling.
- Completed Today tasks are hidden by default in compact mode. Use the small
  arrow at the bottom of Today to reveal or collapse them.
- Press Delete or Backspace on a selected row to remove it immediately when
  it has no subtasks. A task with subtasks asks before deleting the subtree.
- Press Cmd/Ctrl+Z while focus is inside Miller Tasks to undo the latest task
  change. Use Cmd/Ctrl+Shift+Z or Ctrl+Y to redo it. Text inputs keep their
  native character-level undo behavior.
- Click the calendar-plus icon at the end of a tree row to add or remove that
  task from Today. The pinned copy is the same task, so its checkbox and
  metadata stay synchronized.
- Use Arrow Up/Down, Home, and End to move between siblings. Arrow Right enters
  the next column; Arrow Left returns to the parent.
- Drag within a column to reorder. Drop onto a row in another column to make a
  task its child; drop near an edge to insert beside it.
- In Tree View, click a node to open its inspector. Checkboxes and
  Delete/Backspace use the same completion and subtree-deletion rules as the
  Miller columns.
- Edit metadata in the right sidebar. Text saves after 400 ms and immediately
  on blur or task change.
- Create and rename daily tasks in the **Daily tasks** section of the right
  sidebar. Deleting a daily task asks for confirmation.
- Paste images while the inspector is active, or drop them on the Images area.
- Run **Miller Tasks: Toggle completed tasks** to show or hide completed work.
- Run **Miller Tasks: Delete selected task** to delete the selected subtree
  after confirmation.
- **Miller Tasks: Undo last task change** and **Redo last task change** expose
  the same history through the command palette.
- Use **Delete task** in the right-sidebar inspector for the same behavior
  without returning focus to the task row.

Completing a parent completes its full subtree after confirmation. Reopening a
completed parent reopens only that parent. A completed ordinary Today task
remains struck through for 24 hours. At local midnight, every daily-task
instance is removed and replaced with a new incomplete instance; an unfinished
ordinary Today task carries forward. In the hierarchy itself, a newly
completed row remains visible and struck through until the next local day.

Undo/redo keeps up to 100 changes for the current plugin session, including
creation, edits, completion, Today scheduling, moves, ordering, and safe
deletion. The history is intentionally not stored in `data.json`, so it does
not become shared task data. A plugin reload, daily rollover, or an image file
operation starts a fresh history because Obsidian's trash cannot guarantee
that an image can be restored to its original vault path.

## Data and files

Task records are stored by Obsidian through the plugin data API in:

```text
.obsidian/plugins/miller-tasks/data.json
```

The current schema uses logical field versions, stable sibling position keys,
and deletion tombstones. Existing schema-v1 and schema-v2 data migrates
deterministically before the first subsequent save. Cross-device
reconciliation is not connected yet, so mobile support currently means that
the plugin can run and be tested on a phone, not that two devices can safely
edit the same task data simultaneously.

The accepted free synchronization design will move shared state to one
ordinary vault file per installation:

```text
Miller Tasks/Sync/<replica-id>.json
```

Each device will write only its own file and merge all delivered replicas.
This keeps Miller Tasks independent of a paid service or cloud account. The
first cross-platform transport test will use the free Dropbox connection in
the Remotely Save community plugin; Miller Tasks itself will never receive
Dropbox credentials. These replica files are not implemented yet.

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
custom properties, and built-in cloud transport. Daily tasks are the only
automatic re-creation rule.

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
