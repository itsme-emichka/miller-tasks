# Miller Tasks project memory

## Purpose

Miller Tasks is an Obsidian desktop plugin for navigating a recursive task tree
as Miller columns. Selecting a task opens its direct children in the next
column. Task details live in a separate ItemView inside Obsidian's native,
collapsible right sidebar.

This file is maintained after every checkpoint so a future development session
can resume without reconstructing architecture or product decisions.

## Current state

- Checkpoint: 2 of 7 complete.
- Git branch: `main`.
- GitHub repository: `https://github.com/itsme-emichka/miller-tasks`.
- Plugin ID: `miller-tasks`.
- Plugin version: `0.1.0`.
- Minimum Obsidian version: `1.8.0`.
- Next work: checkpoint 3, interactive Miller columns.

The plugin now loads validated schema-v1 task data before registering views.
`TaskStore` owns CRUD, ordering, moves, depth/cycle checks, completion and
deletion cascades, metadata normalization, subscriptions, and queued saves.
The React shell is still static until checkpoint 3.

## Architecture

```text
MillerTasksPlugin
├── TaskPersistence
│   └── validated load + serialized snapshot writes
├── TaskStore
│   └── task graph, invariants, CRUD, subscriptions
├── MillerTasksView (main Obsidian ItemView)
│   └── React root
│       └── MillerTasksApp
│           ├── one shared heading
│           └── horizontally scrolling unlabelled columns
└── MillerTaskInspectorView
    └── native Obsidian right-sidebar leaf
```

- `src/main.ts` owns the Obsidian lifecycle, view registration, ribbon icon,
  commands, data loading, and store lifetime.
- `src/domain/TaskStore.ts` is the only mutation boundary for task data.
- `src/domain/pluginData.ts` validates stored data and normalizes user input.
- `src/data/TaskPersistence.ts` serializes immutable snapshots through
  `Plugin.loadData()` and `Plugin.saveData()`.
- `src/view/MillerTasksView.tsx` is the boundary between Obsidian and React.
- `src/view/MillerTaskInspectorView.ts` is registered separately and opened
  through `Workspace.getRightLeaf(false)`, keeping it in the native sidebar.
- `src/ui/MillerTasksApp.tsx` owns the visual shell. Domain state will be
  injected rather than accessed through global Obsidian objects.
- `styles.css` uses Obsidian theme variables. It does not impose a standalone
  light or dark palette.
- `scripts/setup-dev-vault.mjs` copies production artifacts into an ignored
  dedicated development vault.

## Locked domain model

Checkpoint 2 must introduce:

```ts
type Priority = "none" | "low" | "medium" | "high";

interface TaskRecord {
  id: string;
  parentId: string | null;
  title: string;
  completed: boolean;
  description: string;
  tags: string[];
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  flagged: boolean;
  url: string | null;
  attachments: TaskAttachment[];
  order: number;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}
```

Plugin data has `schemaVersion: 1`, `showCompleted: false`, and a flat task
array. Hierarchy is represented by `parentId`; depth is derived and never
stored.

## Tree invariants

- Root tasks have `parentId: null` and depth 1.
- Maximum task depth is 10.
- A task cannot be its own parent or move below one of its descendants.
- Moving a subtree is rejected if its deepest node would exceed depth 10.
- Sibling order is explicit and normalized after every create, delete, or move.
- Completing a task completes its entire subtree after UI confirmation.
- Reopening a task reopens only that task.
- Deleting a task removes the entire subtree after UI confirmation.

## Persistence decisions

- Use `Plugin.loadData()` and `Plugin.saveData()`.
- Validate loaded data before it reaches UI state.
- Serialize saves through one promise queue.
- Use optimistic UI only when a failed write can be rolled back and surfaced.
- Preserve `schemaVersion` for future migrations.
- Task timestamps are epoch milliseconds.
- Due date and time remain local strings and are never timezone-converted.

## Visual direction

The UI is intentionally reduced to the hierarchy itself:

- One `Miller Tasks` heading spans the entire main view.
- Columns have no visible headings, level labels, counters, path rail, status,
  badges, instructional empty states, or embedded inspector.
- Every surface uses `--background-primary`; columns differ only through a
  one-pixel Obsidian border.
- Typography comes entirely from Obsidian interface tokens.
- The inspector is absent from the main view and uses the standard collapsible
  right sidebar.

The layout is:

```text
┌───────────────────────────────────────────────┐ ┌───────────┐
│ Miller Tasks                                  │ │ Obsidian  │
├───────────────┬───────────────┬───────────────┤ │ right     │
│               │               │               │ │ sidebar   │
│   column      │   column      │      …        │ │ inspector │
└───────────────┴───────────────┴───────────────┘ └───────────┘
```

## Development commands

```bash
npm run lint
npm run test
npm run build
npm run check
npm run dev:vault
```

The complete checkpoint verification command is `npm run check`.

## Documentation protocol

At the end of every checkpoint:

1. Update the checkbox and current checkpoint in `PLAN.md`.
2. Update this file with architecture changes, decisions, known issues,
   verification output, and the next exact task.
3. Run `npm run check`.
4. Create exactly one checkpoint commit.
5. Push `main`.
6. Report the commit, checks, and visual result when applicable.
7. Continue automatically when checks are green unless the user redirects.

## Known limitations

- The current shell is still static.
- No inspector form, drag-and-drop UI, or attachment file handling exists yet.
- The development vault is local and ignored by Git.

## Checkpoint 1 verification

Checkpoint 1 was verified on 2026-07-17:

- `npm run lint`: passed with no warnings.
- `npm run test`: 2 of 2 UI foundation tests passed.
- `npm run build`: TypeScript check and production esbuild bundle passed.
- `npm run dev:vault`: copied all three required plugin artifacts and enabled
  `miller-tasks` in the isolated vault.
- Obsidian 1.12.7 loaded the plugin in the isolated `dev-vault`.
- The command `miller-tasks:open-task-browser` opened the custom ItemView.
- The original rendered view showed the first visual-shell proposal. That
  proposal was intentionally replaced by the later minimal-interface
  correction.

## Minimal-interface correction verification

The correction was verified on 2026-07-17:

- `npm run check`: lint, 2 of 2 UI tests, TypeScript, and production bundle
  passed.
- The rebuilt plugin loaded in the isolated Obsidian 1.12.7 dev-vault.
- The main view contained exactly one heading, two column shells, no toolbar,
  no path rail, no column headers, and no embedded inspector.
- Computed backgrounds for the shell and every column were identical.
- `miller-task-inspector-view` rendered inside
  `.workspace-split.mod-right-split`.
- Obsidian's built-in `app:toggle-right-sidebar` command collapsed that split
  from 300 pixels to 0 and added `is-sidedock-collapsed`.

## Next exact task

Implement checkpoint 3:

1. Inject `TaskStore` into the React ItemView.
2. Render root and selected-child columns without visible column headers.
3. Add task creation, selection, inline rename, and completion controls.
4. Add the completed-task visibility toggle without adding a toolbar.
5. Keep selection paths valid after mutations and reloads.
6. Verify, document, commit, push, then continue automatically.

## Checkpoint 2 verification

- Schema-v1 data is validated before view registration.
- New vaults receive empty defaults without writing until a mutation.
- Twelve tests cover depth 10, level-11 rejection, cycles, subtree depth,
  sibling order, moves, completion/reopen behavior, deletion cascades,
  metadata normalization, corrupted data, serialized writes, and reloads.
- `npm run check` passed before commit.
