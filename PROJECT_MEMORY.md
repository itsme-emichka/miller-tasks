# Miller Tasks project memory

## Purpose

Miller Tasks is an Obsidian desktop plugin for navigating a recursive task tree
as Miller columns. Selecting a task opens its direct children in the next
column while a fixed inspector keeps the selected task's details editable.

This file is maintained after every checkpoint so a future development session
can resume without reconstructing architecture or product decisions.

## Current state

- Checkpoint: 1 of 7 complete.
- Git branch: `main`.
- GitHub repository: `https://github.com/itsme-emichka/miller-tasks`.
- Plugin ID: `miller-tasks`.
- Plugin version: `0.1.0`.
- Minimum Obsidian version: `1.8.0`.
- Next work: checkpoint 2, task model and persistent store.

The current plugin registers an ItemView, ribbon action, and command. It mounts
a React visual shell with a root column, a preview child column, the selected
path rail, and a fixed empty inspector. No task data exists yet.

## Architecture

```text
MillerTasksPlugin
└── MillerTasksView (Obsidian ItemView)
    └── React root
        └── MillerTasksApp
            ├── toolbar
            ├── selected-path rail
            └── workspace
                ├── horizontally scrolling columns
                └── fixed inspector
```

- `src/main.ts` owns the Obsidian lifecycle, view registration, ribbon icon,
  command, and view activation.
- `src/view/MillerTasksView.tsx` is the boundary between Obsidian and React.
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

The UI inherits Obsidian colors and interface fonts. The signature element is
the selected-path rail: an accent line that visually connects the current
lineage across otherwise quiet columns. Structural labels such as “Level 1”
encode real hierarchy depth rather than decorative numbering.

The layout is:

```text
┌─────────────────────────────────────────────────────────────┐
│ Miller Tasks                                  project state │
├──────────────── selected path rail ─────────────────────────┤
│ level 1 │ level 2 │ … horizontally scrollable │ inspector  │
│ tasks   │ children│                           │ fixed       │
└─────────────────────────────────────────────────────────────┘
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
7. Stop until the user says **continue**.

## Known limitations

- The current shell is intentionally static.
- No task model, persistence, inspector form, drag-and-drop, or attachments
  exist yet.
- The development vault is local and ignored by Git.

## Latest verification

Checkpoint 1 was verified on 2026-07-17:

- `npm run lint`: passed with no warnings.
- `npm run test`: 2 of 2 UI foundation tests passed.
- `npm run build`: TypeScript check and production esbuild bundle passed.
- `npm run dev:vault`: copied all three required plugin artifacts and enabled
  `miller-tasks` in the isolated vault.
- Obsidian 1.12.7 loaded the plugin in the isolated `dev-vault`.
- The command `miller-tasks:open-task-browser` opened the custom ItemView.
- The rendered view showed the root column, child preview, path rail, and fixed
  inspector using the active Obsidian light theme.

## Next exact task

Implement checkpoint 2 only:

1. Add the TypeScript domain types and schema defaults.
2. Add validation for data loaded from Obsidian.
3. Add an in-memory tree service with CRUD and tree invariants.
4. Add a persistence adapter with serialized saves.
5. Add unit tests for depth, cycles, ordering, cascades, and reload behavior.
6. Update this memory and `PLAN.md`, verify, commit once, push, report, stop.
