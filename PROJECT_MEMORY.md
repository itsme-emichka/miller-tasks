# Miller Tasks project memory

## Purpose

Miller Tasks is an Obsidian desktop plugin for navigating a recursive task tree
as Miller columns. Selecting a task opens its direct children in the next
column. Task details live in a separate ItemView inside Obsidian's native,
collapsible right sidebar.

This file is maintained after every checkpoint so a future development session
can resume without reconstructing architecture or product decisions.

## Current state

- Checkpoint: 10b complete; 10c pending.
- Git branch: `main`.
- GitHub repository: `https://github.com/itsme-emichka/miller-tasks`.
- Plugin ID: `miller-tasks`.
- Plugin version: `0.1.0`.
- Minimum Obsidian version: `1.8.0`.
- Next work: retain completed tree rows until the next local day.

The plugin loads and migrates validated schema-v1 or schema-v2 task data before
registering views.
`TaskStore` owns CRUD, ordering, moves, depth/cycle checks, completion and
deletion cascades, metadata normalization, subscriptions, and queued saves.
The main React view now renders the live task tree as horizontally scrolling
Miller columns.

## Architecture

```text
MillerTasksPlugin
├── TaskPersistence
│   └── validated load + serialized snapshot writes
├── TaskAttachmentService
│   └── vault copies, resource URLs, opening, and trash
├── TaskStore
│   └── task graph, invariants, CRUD, subscriptions
├── TaskSelection
│   └── shared selected-task state
├── TaskDraftBuffer
│   └── 400 ms text debounce + synchronous flush
├── one-minute local rollover
│   └── Today retention + daily-instance replacement
├── MillerTasksView (main Obsidian ItemView)
│   └── React root
│       └── MillerTasksApp
│           ├── one shared heading
│           ├── pinned Today projection
│           └── horizontally scrolling unlabelled tree columns
└── MillerTaskInspectorView (native right-sidebar ItemView)
    └── React root
        └── TaskInspectorApp
            └── DailyTasksEditor
```

- `src/main.ts` owns the Obsidian lifecycle, view registration, ribbon icon,
  commands, data loading, and store lifetime.
- `src/domain/TaskStore.ts` is the only mutation boundary for task data.
- `src/domain/pluginData.ts` validates stored data and normalizes user input.
- `src/data/TaskPersistence.ts` serializes immutable snapshots through
  `Plugin.loadData()` and `Plugin.saveData()`.
- `src/data/TaskAttachmentService.ts` is the only boundary for image files in
  the Obsidian vault.
- `src/state/TaskSelection.ts` synchronizes the main browser and inspector
  without a global React tree.
- `src/state/TaskDraftBuffer.ts` merges text edits per task, saves after 400
  ms, and flushes before selection changes, blur, view close, and unload.
- `src/state/runTaskRollover.ts` applies deterministic rollover and clears a
  selected daily instance when that instance is replaced.
- `src/view/MillerTasksView.tsx` is the boundary between Obsidian and React.
- `src/view/MillerTaskInspectorView.ts` is registered separately and opened
  through `Workspace.getRightLeaf(false)`, keeping it in the native sidebar.
- `src/ui/MillerTasksApp.tsx` subscribes to the injected store, owns the
  selected ancestry path, renders pinned Today plus root and selected-child
  columns, and hosts the shared `@dnd-kit` context for the tree. It also owns
  Finder-style arrow navigation and focus restoration without moving the
  horizontal viewport.
- `src/ui/taskDrop.ts` converts row/column drop targets into store moves.
- `src/view/ConfirmationModal.ts` provides native Obsidian confirmations for
  parent completion and subtree deletion.
- `src/ui/TaskInspectorApp.tsx` renders task metadata and daily-template
  controls inside the native right sidebar. Date, time, priority, and flag
  save immediately.
- `src/domain/due.ts` computes overdue state from local date/time strings.
- `styles.css` uses Obsidian theme variables. It does not impose a standalone
  light or dark palette.
- `scripts/setup-dev-vault.mjs` copies production artifacts into an ignored
  dedicated development vault.

## Domain model

Checkpoint 2 introduced:

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
  today: boolean;
  todayAddedAt: number | null;
  dailyTemplateId: string | null;
  generatedForDate: string | null;
}
```

Plugin data uses `schemaVersion: 2`, `showCompleted: false`, a flat task array,
and ordered `DailyTaskTemplate` records. Schema-v1 data migrates in memory by
adding inactive Today fields and an empty template list. Hierarchy is
represented by `parentId`; depth is derived and never stored.

## Today and daily invariants

- A normal tree task has `dailyTemplateId: null` and can be projected into
  Today without copying it by setting `today` and `todayAddedAt`.
- An unfinished marked tree task remains in Today across local-day changes.
- A completed marked tree task remains visible for exactly 24 hours after
  `completedAt`, then rollover clears its Today marker.
- A daily template creates exactly one isolated task instance for the current
  local date.
- Daily instances never appear in the tree, accept children, move, or own image
  attachments.
- At local midnight, every prior daily instance is deleted and a fresh,
  incomplete instance is generated, regardless of prior completion.
- Local-day rollover is deterministic and catches up after Obsidian was closed.

## Tree invariants

- Root tasks have `parentId: null` and depth 1.
- Maximum task depth is 10.
- A task cannot be its own parent or move below one of its descendants.
- Moving a subtree is rejected if its deepest node would exceed depth 10.
- Sibling order is explicit and normalized after every create, delete, or move.
- Completing a task completes its entire subtree after UI confirmation.
- Reopening a task reopens only that task.
- Deleting a task removes the entire subtree after UI confirmation.
- A row dropped on a row in another column becomes its child. Dropping near
  that row's edge inserts beside it; dropping on column space moves to the end.
- Rows in one column use sortable ordering. The selected task's ancestry path
  is reconstructed after a valid move so the selection survives reparenting.

## Persistence decisions

- Use `Plugin.loadData()` and `Plugin.saveData()`.
- Validate loaded data before it reaches UI state.
- Serialize saves through one promise queue.
- Use optimistic UI only when a failed write can be rolled back and surfaced.
- Preserve `schemaVersion` for future migrations.
- Task timestamps are epoch milliseconds.
- Due date and time remain local strings and are never timezone-converted.
- Images are copied to
  `Miller Tasks/Attachments/<task-id>/<attachment-id>-<safe-name>`.
- The attachment record is added only after `Vault.createBinary()` succeeds.
- Removal trashes the vault file before removing its task record. A trash
  failure leaves the record unchanged.
- Confirmed subtree deletion trashes all recorded images before deleting task
  records; a trash error aborts the task deletion.

## Visual direction

The UI is intentionally reduced to the hierarchy itself:

- One `Miller Tasks` heading spans the entire main view.
- Task rows use Obsidian's `task-list-item-checkbox` followed by a plain text
  `span`; task titles are never rendered as visual buttons or cards.
- Columns have no visible headings, level labels, counters, path rail, status,
  badges, instructional empty states, or embedded inspector.
- Every surface uses `--background-primary`; columns differ only through a
  one-pixel Obsidian border.
- Typography comes entirely from Obsidian interface tokens.
- The inspector is absent from the main view and uses the standard collapsible
  right sidebar.

The layout is:

```text
┌───────────────────────────────────────────────────────────────┐ ┌───────────┐
│ Miller Tasks                                                  │ │ Obsidian  │
├───────────────┬───────────────────────────────────────────────┤ │ right     │
│ pinned Today  │ manually scrolling hierarchy columns →       │ │ sidebar   │
└───────────────┴───────────────────────────────────────────────┘ └───────────┘
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

- Completed-task visibility is controlled through the command palette so the
  main view remains free of toolbar controls.
- Deletion is exposed as the `Delete selected task` command to keep destructive
  controls out of the minimal column surface.
- Empty attachment folders are currently retained after their last file moves
  to trash; they are harmless and keep filesystem logic conservative.
- This is a source beta, not an Obsidian community-plugin release. Installation
  currently requires building and copying the three artifacts.
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

## Checkpoint 2 verification

- Schema-v1 data is validated before view registration.
- New vaults receive empty defaults without writing until a mutation.
- Twelve tests cover depth 10, level-11 rejection, cycles, subtree depth,
  sibling order, moves, completion/reopen behavior, deletion cascades,
  metadata normalization, corrupted data, serialized writes, and reloads.
- `npm run check` passed before commit.

## Checkpoint 3 verification

- Fourteen tests cover the domain and interactive task navigation.
- UI tests verify the single-heading/no-chrome contract, creation, child
  navigation, inline rename, hidden completion, and showing completed tasks.
- `npm run check` passed with lint, all tests, TypeScript, and production
  bundle green.
- Obsidian 1.12.7 created a three-level path through the rendered UI and showed
  four columns: root, children, grandchildren, and the empty next level.
- Reloading the plugin restored all three task records from `data.json`.
- The inspected view retained one heading, no column headers, and a uniform
  `--background-primary` surface.

## Checkpoint 4 verification

- Twenty-two tests cover domain logic, persistence, navigation, inspector
  editing, URL validation, metadata, overdue state, debounce, and flush.
- `npm run check` passed with lint, all tests, TypeScript, and production
  bundle green.
- Obsidian 1.12.7 opened the selected task in a 300-pixel native right sidebar.
- Description, normalized tags, due date/time, high priority, flag, and an
  absolute HTTPS URL persisted to `data.json`.
- A task due on the previous local date rendered its title and date with
  Obsidian's `--text-error` color (`rgb(233, 49, 71)` in the tested theme).
- The inspector remained outside the main Miller columns view and used the
  same primary background.

## Checkpoint 5 verification

- Twenty-six tests cover domain logic, persistence, navigation, inspector
  editing, drop actions, selection preservation, and delegated completion.
- `npm run check` passed with lint, all tests, TypeScript, and production
  bundle green.
- Pointer drag in Obsidian moved a root task onto a row in another column and
  persisted the new parent.
- Keyboard drag reordered siblings and persisted contiguous order values.
- Moving a parent onto its descendant was rejected; the parent remained at the
  root and Obsidian displayed the cycle-protection Notice.
- Cancelling parent completion left the parent and all descendants incomplete.
- Confirmed deletion removed a disposable selected task from persisted data.

## Checkpoint 6 verification

- Twenty-nine tests cover the complete domain, persistence, UI, drop actions,
  attachment copying/opening/removal, and trash-failure preservation.
- `npm run check` passed with lint, all tests, TypeScript, and production
  bundle green.
- Two SVG images dropped together into the inspector were copied to the
  selected task folder, recorded in JSON, and rendered as compact previews.
- Confirmed image removal removed its record and moved its vault file to trash.
- A disposable task with an image was deleted only after confirmation; both
  its task record and attachment path disappeared.
- The attachment grid stayed inside the native 300-pixel right sidebar and
  retained the primary Obsidian background.

## Checkpoint 7 verification

- Thirty-one tests cover the domain, persistence, task/attachment services,
  inspector, Miller navigation, keyboard behavior, drop actions, and error
  preservation.
- The UI created levels 1 through 10. A direct attempt at level 11 returned
  `TaskDomainError` with `depth-exceeded`; deleting the root removed all ten.
- Arrow Right focused the next column and Arrow Left returned to the parent.
- A past-due task was red while incomplete, disappeared on completion, and
  returned without overdue state when completed tasks were shown.
- The native inspector collapsed from 300 pixels to 0 through Obsidian's
  built-in right-sidebar command.
- In the tested light theme, shell, every column, and inspector all computed to
  `rgb(255, 255, 255)`. In dark, all computed to `rgb(30, 30, 30)`.
- With reduced motion enabled, task-row transition duration computed to `0s`.
- `main.js`, `manifest.json`, and `styles.css` were rebuilt and installed into
  the isolated Obsidian 1.12.7 vault.
- `npm run check` passed with lint, all tests, TypeScript, and the production
  bundle green.

## Checkpoint commits

- Bootstrap: `ff535e3`
- Minimal-interface correction: `f6b9bd8`
- Task model and store: `a2167a9`
- Miller navigation: `ecba301`
- Inspector and due state: `76c06c5`
- Drag-and-drop actions: `0f59942`
- Image attachments: `00923d0`
- Beta polish: `f6f41de`
- GitHub Actions Node 24 runtime update: `c1876a9`
- Native checkbox-and-text task rows: `b6d7263`
- Manual-only Miller viewport: `0b22a6d`
- Today and daily task model: `ac0d03e`
- Pinned Today projection: `f72783d`
- Daily-template inspector controls: `2890120`
- Rollover scheduler and final documentation: the commit containing this
  documentation

## Manual viewport correction

- Selecting or creating a task never calls `scrollIntoView`.
- Keyboard focus restoration uses `focus({ preventScroll: true })`.
- A live pointer click with four rendered columns preserved the manually set
  horizontal position exactly (`scrollLeft: 120` before and after).
- Horizontal column movement is exclusively controlled by the user's mouse,
  trackpad, scrollbar, or other native scrolling input.

## Native task-row correction verification

- Task titles render as `SPAN` elements and retain button semantics only for
  keyboard accessibility.
- Checkboxes use Obsidian's native `task-list-item-checkbox` class.
- Computed task-row bottom border is `0px`; unselected text has `0px` border
  and no box shadow.
- Selection is represented only by the existing two-pixel Finder accent.
- `npm run check` remains green with 31 tests after the viewport regression
  coverage.

## Resume point

The first prototype is complete. Resume from user-reported behavior or visual
refinement requests. Preserve the accepted timing semantics and manual-only
horizontal viewport.

## Checkpoint 8 verification

- Schema-v1 task data migrates to schema v2 without content changes.
- Thirty-four tests pass.
- Tests cover 24-hour completed retention, unfinished carry-forward, local
  midnight replacement, template rename synchronization, and template
  deletion.
- `npm run check` passed with lint, all tests, TypeScript, and production
  bundle green.

## Checkpoint 9a verification

- Today is pinned in its own fixed-width column outside the horizontally
  scrolling Miller hierarchy.
- Every tree row exposes a compact calendar-plus control without changing the
  native Obsidian checkbox-and-text appearance.
- Clicking the calendar control does not select the task, open the inspector,
  or move the horizontal viewport.
- Today renders the same task record, so completion and overdue state update
  immediately in both locations.
- Completed Today tasks remain visible even while completed tree tasks are
  globally hidden.
- Thirty-six tests pass, including pinned-layout, direct-add, shared
  completion, and manual-scroll regression coverage.
- `npm run check` passed with lint, all tests, TypeScript, and production
  bundle green.

## Checkpoint 9b verification

- Daily templates are created, renamed, and deleted from the native
  right-sidebar inspector, including when no tree task is selected.
- Creating a template immediately creates today's incomplete instance and
  projects it into Today.
- Renaming a template updates today's instance; deleting it removes both the
  template and its current instance after native confirmation.
- Daily instances do not expose image controls because they are discarded and
  recreated at local midnight.
- Thirty-seven tests pass, including daily-template creation, rename
  synchronization, delegated deletion, and empty-selection access.
- `npm run check` passed with lint, all tests, TypeScript, and production
  bundle green.

## Checkpoint 9c verification

- Rollover runs once during plugin startup and every 60 seconds while Obsidian
  remains open.
- A selected daily instance is cleared safely when midnight rollover replaces
  it, so the inspector never keeps a stale selection.
- The generic delete-selected command delegates a daily instance to confirmed
  template deletion instead of allowing it to reappear one minute later.
- Thirty-eight tests pass across ten test files.
- `npm run check`, `git diff --check`, and the production dev-vault build pass.
- The updated build was installed into the isolated dev-vault. A new
  automated Obsidian screenshot was not captured because the running Obsidian
  instance did not expose its local debugging port and macOS denied assistive
  access; layout and no-autoscroll behavior remain covered by React tests.

## Checkpoint 10a verification

- Ordinary, explicitly selected Today tasks always render before generated
  daily instances.
- A single one-pixel Obsidian theme border separates the two groups only when
  both are present; no new heading or label was added.
- Domain ordering and rendered separator placement are covered by tests.

## Checkpoint 10b verification

- Scheduling a leaf task adds that task to Today.
- Scheduling any branch recursively adds only its deepest leaf descendants;
  the branch and intermediate nodes do not appear in Today.
- A branch calendar icon is active when all of its current leaves are in
  Today; removing the branch clears those leaf projections together.
- Completing the final incomplete child automatically completes its ancestors.
  Reopening a child reopens every affected ancestor without reopening siblings.
- Tree creation, deletion, and reparenting also resynchronize affected parent
  completion states.
