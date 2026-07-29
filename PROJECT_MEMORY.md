# Miller Tasks project memory

## Purpose

Miller Tasks is an Obsidian desktop plugin for navigating a recursive task tree
as Miller columns. Selecting a task opens its direct children in the next
column. Task details live in a separate ItemView inside Obsidian's native,
collapsible right sidebar.

This file is maintained after every checkpoint so a future development session
can resume without reconstructing architecture or product decisions.

## Current state

- Checkpoint: 13b complete.
- Git branch: `main`.
- GitHub repository: `https://github.com/itsme-emichka/miller-tasks`.
- Plugin ID: `miller-tasks`.
- Plugin version: `0.1.0`.
- Minimum Obsidian version: `1.8.0`.
- Next work: checkpoint 13c, adding serialized
  `onExternalSettingsChange()` reconciliation, save-echo suppression,
  conflict delivery, and operation-based local Undo/Redo.

The plugin validates schema v3 or deterministically migrates schema-v1/schema-v2
task data before registering views.
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
├── schema-v3 synchronization domain
│   ├── deterministic schema-v1/v2 migration + canonical serialization
│   ├── stable position keys + legacy-compatible UI materialization
│   └── pure entity/field/tombstone/conflict merge
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
├── MillerTaskTreeView (separate Obsidian ItemView)
│   └── React root
│       └── TaskTreeApp
│           ├── deterministic top-down node layout
│           └── orthogonal parent-child connections
└── MillerTaskInspectorView (native right-sidebar ItemView)
    └── React root
        └── TaskInspectorApp
            └── DailyTasksEditor
```

- `src/main.ts` owns the Obsidian lifecycle, view registration, ribbon icon,
  commands, data loading, and store lifetime.
- `src/domain/TaskStore.ts` preserves the public import boundary while
  `src/domain/VersionedTaskStore.ts` owns all live schema-v3 mutations.
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
- `src/sync/syncData.ts` defines the isolated schema-v3 synchronization model,
  deterministic migration position keys and daily occurrence IDs, defensive
  canonicalization, and byte-stable JSON serialization.
- `src/sync/mergeSyncData.ts` provides the pure state join, three-way conflict
  recognition, logical-version comparison, entity and attachment presence,
  and conflict-dismissal filtering.
- `src/sync/parseSyncData.ts` validates persisted schema v3 and routes legacy
  data through deterministic migration.
- `src/sync/positionKey.ts` creates stable lexicographic keys before, between,
  and after siblings without rewriting neighboring records.
- `src/sync/materializeSyncData.ts` derives the unchanged schema-v2-shaped view
  snapshot, including contiguous display-only `order` values, from schema-v3
  persistence.
- `src/view/MillerTasksView.tsx` is the boundary between Obsidian and React.
- `src/view/MillerTaskInspectorView.ts` is registered separately and opened
  through `Workspace.getRightLeaf(false)`, keeping it in the native sidebar.
- `src/ui/MillerTasksApp.tsx` subscribes to the injected store, owns the
  selected ancestry path, renders pinned Today plus root and selected-child
  columns, and hosts the shared `@dnd-kit` context for the tree. It also owns
  Finder-style arrow navigation and focus restoration without moving the
  horizontal viewport.
- `src/ui/taskDrop.ts` converts row/column drop targets into store moves.
- `src/ui/taskTreeLayout.ts` deterministically places complete task forests
  from top to bottom without overlaps or force simulation.
- `src/ui/TaskTreeApp.tsx` renders that layout as a manually scrollable canvas,
  subscribes to the same store and selection, and delegates completion and
  deletion to the plugin lifecycle.
- `src/view/MillerTaskTreeView.tsx` registers the React canvas as its own
  Obsidian ItemView.
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

`TaskRecord` is now the compatibility view model consumed by existing UI code.
Persisted plugin data uses schema v3: normal tasks and deterministic daily
occurrences are separate, mutable field groups carry logical versions,
deletions remain as tombstones, and sibling order uses `positionKey`.
Schema-v1/schema-v2 data migrates deterministically in memory and is saved as
schema v3 on the next mutation. Hierarchy is represented by `parentId`; depth
and contiguous display-only `order` values are derived and never persisted.

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
- Sibling order uses stable lexicographic position keys. Create or move changes
  only the affected task; deleting a sibling rewrites no surviving task.
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
- The serialized save queue remains the local write boundary. External
  settings reconciliation is not active until checkpoint 13c.
- The accepted schema-v3 design is state-based and merges versioned atomic
  fields, stable structural positions, entity tombstones, attachment
  add/remove entries, and deterministic daily occurrences.
- Logical version stamps, not wall-clock timestamps, resolve conflicts.
- Same-field concurrent values produce a synchronized conflict record rather
  than silently discarding the losing value.
- Tombstones remain indefinitely until a future acknowledged-replica garbage
  collection protocol exists.
- Normal field edits cannot resurrect a tombstoned entity. Only a direct local
  Undo without trashed attachments may write a newer intentional-presence
  stamp for the same ID.
- `Plugin.onExternalSettingsChange()` will feed validated incoming snapshots
  through the same serialized boundary as local saves.
- A material external merge clears local Undo/Redo; an echo/no-op does not.
- The inactive-device overwrite scenario is a release gate. If Obsidian Sync
  cannot deliver both branches to the merge engine, task state must move to
  unique per-replica vault files before mobile support is enabled.
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

The alternate hierarchy view is:

```text
                root task
               ┌────┴────┐
           child         child
          ┌───┴───┐
       grandchild grandchild
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
- `isDesktopOnly` intentionally remains `true` until schema-v3 synchronization,
  the two-device release matrix, the mobile API audit, and the phone/tablet UI
  are complete.
- Schema v3 is live, but `onExternalSettingsChange()` is not wired yet; this
  checkpoint alone must not be treated as simultaneous multi-device support.
- Undo/Redo still restores full schema-v3 snapshots as a desktop-only
  transition. Checkpoint 13c must replace this with freshly versioned inverse
  operations before external merges are accepted.

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
- The selected ancestry path uses Obsidian's interactive accent color. Only
  the current deepest task is underlined; ancestors have color alone.
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

## Checkpoint 10c verification

- A tree task completed on the current local date remains visible with the
  existing line-through treatment, even when global completed visibility is
  off.
- The task disappears from the tree after local midnight; the global command
  can still reveal it.
- The view keeps its own minute-resolution clock so date visibility changes
  without requiring a task mutation or moving the horizontal viewport.
- Today remains independent: an ordinary Today task still uses its exact
  24-hour completed retention.

## Checkpoint 10d verification

- The native right-sidebar inspector exposes a minimal red-text `Delete task`
  action for the selected task.
- Deletion still requires native confirmation and removes the complete
  subtree through `TaskStore.deleteSubtree`.
- All recorded images in the subtree move through Obsidian's configured trash
  behavior before task records are removed; a trash failure aborts deletion.
- Deleting a daily instance delegates to confirmed daily-template deletion.
- The existing command-palette deletion action uses the same implementation.

## Checkpoint 10e verification

- Clicking a task title focuses it with `preventScroll`, preserving the
  manually controlled horizontal viewport.
- Delete and Backspace remove the focused selected row from both the tree and
  Today.
- Leaf tasks delete immediately. Branch tasks show native confirmation with
  the exact subtask count before the full subtree is removed.
- Inline rename, new-task fields, inspector fields, and other text inputs keep
  normal Delete and Backspace behavior.

## Checkpoint 10f verification

- Every selected node in the active Miller path uses the current Obsidian
  interactive accent for both its text and one-pixel underline.
- The previous two-pixel stripe is removed completely.
- A selected completed task keeps its line-through together with the selection
  underline.
- Overdue and completed colors apply normally until the row becomes selected;
  selection then takes visual precedence as the user requested.

## Checkpoint 10g verification

- Every node in the open ancestry path remains accent-colored so hierarchy is
  readable across columns.
- Only `selectedPath.at(-1)` receives `data-active="true"` and the selection
  underline.
- Moving deeper transfers the underline to the child and leaves every ancestor
  color-only; moving back transfers it to the new current node.
- Completed current tasks retain line-through plus underline.

## Checkpoint 10h verification

- A Today task with `parentId` shows its direct parent's current title below
  the task title.
- Root tasks and generated daily instances keep the original one-line
  presentation.
- Parent context uses Obsidian's `--text-faint` and smaller interface type,
  with single-line truncation for long titles.
- The caption adds no icon, heading, card, alternate background, or new
  interaction target.

## Checkpoint 10i verification

- Ordinary Today tasks remain above the daily section and the existing
  hairline stays between those groups.
- Inside both ordinary and daily groups, incomplete tasks sort before
  completed tasks.
- Stable task-added order and daily-template order remain unchanged within
  the same completion state.
- Completing or reopening a task immediately moves it to the appropriate
  position through the existing store subscription.

## Checkpoint 11a verification

- Root tasks occupy depth zero and every child depth is rendered below its
  parent.
- Leaf slots preserve explicit sibling and root order with a fixed minimum
  horizontal gap.
- Branch parents center over the first-to-last child span.
- Edges expose exact parent-bottom and child-top connection coordinates.
- Generated daily instances are excluded because they do not belong to the
  persistent hierarchy.

## Checkpoint 11b verification

- A separate `MillerTaskTreeView` opens through the `git-fork` ribbon icon or
  `Miller Tasks: Open task tree`.
- All persistent hierarchy tasks render, including completed tasks; generated
  daily instances remain in Today only.
- Orthogonal one-pixel connections use Obsidian theme borders and run from
  parent bottoms to child tops.
- Nodes keep the native checkbox-plus-text task treatment without cards,
  alternate surfaces, physics, or decorative controls.
- Clicking a node updates shared selection and opens the native right-sidebar
  inspector. Completion, Delete, and Backspace delegate to the same confirmed
  subtree actions as Miller columns.
- The canvas never centers or scrolls automatically; mouse, trackpad, and
  native scrollbars retain full viewport control.
- Fifty-eight tests across thirteen files, lint, TypeScript, and the production
  build pass.

## Checkpoint 11c verification

- One icon sits immediately left of the shared `Miller Tasks` heading in both
  presentation modes.
- The icon replaces the current Obsidian leaf view in place: columns switch to
  Tree View and Tree View switches back to columns without opening another tab.
- The separate Tree View ribbon action was removed; the existing command
  palette action remains available for direct opening.
- The toggle inherits Obsidian colors and focus treatment without introducing
  a separate toolbar, card, or alternate background.

## Checkpoint 11d verification

- Tree View exposes compact `−`, percentage reset, `+`, and `Fit` controls at
  the right side of the same shared header.
- Cmd/Ctrl+wheel changes zoom while an unmodified wheel retains native
  horizontal and vertical scrolling.
- Zoom is clamped from 2% through 200%. `Fit` measures the current viewport and
  scales the complete layout down so every task is visible at once.
- The scaled canvas keeps one uniform Obsidian primary background; task nodes
  remain native checkbox-and-text rows and edges retain a one-pixel apparent
  weight.
- View selection never changes scale or scroll position. Only explicit zoom,
  Fit, and native manual scrolling move the tree presentation.
- Sixty-two tests across thirteen files, lint, TypeScript, and the production
  build pass after the view-toggle and zoom additions.

## Checkpoint 12 verification

- `TaskStore` keeps at most 100 before/after snapshots in memory for the
  current plugin session. History is deliberately absent from `PluginData`.
- Undo/Redo covers task and daily-template creation, metadata edits,
  completion cascades, Today projection, reorder, reparenting, and deletion
  when no image file was moved to trash.
- A new mutation after Undo clears the redo branch. Undo and redo both notify
  every active view and enter the same sequential persistence queue as normal
  changes.
- `showCompleted` remains a presentation preference and is preserved across
  task history restoration.
- Daily rollover and image add/remove operations form safety barriers and
  clear history. Deleting any subtree that owns images also clears history,
  preventing restoration of task records whose files may already be in an
  unrecoverable system trash location.
- The command palette exposes `Undo last task change` and
  `Redo last task change`.
- Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, and Ctrl+Y work only while focus is inside a
  Miller columns, Tree View, or task-inspector leaf. Text inputs, textareas,
  selects, and content-editable elements retain their native editing history.
- Selection is reconciled after restoration: missing tasks are deselected and
  a recreated task can reopen in the existing inspector.
- History is intentionally device-local and ephemeral, keeping the persisted
  task model suitable for a later mobile synchronization design.
- Seventy tests across fourteen files, lint, TypeScript, and the production
  build pass.

## Checkpoint 12a verification

- After Delete or Backspace removes the focused task row, the browser can move
  keyboard focus to the document body. History shortcuts now recognize that
  focus-loss state when a Miller Tasks leaf remains active.
- The document listener runs in the capture phase so Obsidian cannot consume
  Cmd/Ctrl+Z before the plugin sees it.
- The fallback accepts only the document, `html`, or `body`; buttons and other
  elements outside Miller Tasks do not trigger task history.
- Native text input Undo remains excluded exactly as before.
- Seventy-one tests across fourteen files, lint, TypeScript, and the
  production build pass.

## Checkpoint 13 synchronization design

- `SYNC_DESIGN.md` is the accepted source of truth for mobile data
  synchronization and conflict behavior.
- Obsidian or another vault synchronization provider remains transport; Miller
  Tasks adds no account, backend, direct network client, or telemetry.
- Schema v3 will version task fields at atomic boundaries, retain deletion
  tombstones, use stable position keys, and merge incoming external settings
  deterministically.
- Concurrent edits to different fields combine. Same-field divergence chooses
  a deterministic visible value and preserves the other value in a conflict
  record.
- Merge repair rescues new children of deleted parents, breaks concurrent
  cycles, and preserves the 10-level limit without deleting surviving tasks.
- Daily instances become deterministic occurrences keyed by template ID and
  local date, preventing duplicate same-day instances across devices.
- Attachment metadata tolerates files arriving later through the sync
  provider; missing files never cause destructive metadata cleanup.
- Undo/Redo remains bounded, device-local, and absent from synchronized data.
  Under schema v3, Undo and Redo emit fresh versioned mutations instead of
  restoring obsolete sync metadata.
- `isDesktopOnly` stays `true` until the complete two-device matrix passes and
  mobile API, dependency, touch, and layout work is verified.

## Checkpoint 13a schema-v3 foundation

- The new synchronization domain remains disconnected from live
  `TaskPersistence`, so installing this checkpoint cannot migrate or rewrite
  existing user task data.
- Schema v1 and schema v2 migrate deterministically to an isolated schema-v3
  document with logical versions, entity/attachment/conflict tombstones,
  stable migration position keys, and canonical array ordering.
- Existing normal task IDs and values are preserved. Random schema-v2 daily
  instance IDs become deterministic `<template-id>:<local-date>` occurrences.
- Canonical serialization is byte-stable and defensively clones nested tags,
  attachments, versions, and conflict values.
- The pure merge combines independent entity creation and different-field
  edits, resolves same-field divergence by logical stamp, and retains the
  losing value in one deduplicated conflict record.
- Tombstones suppress older task and attachment state. A newer explicit
  existence stamp supports intentional local Undo without allowing an old
  offline field edit to resurrect an entity.
- Versioned conflict tombstones prevent dismissed conflicts from returning.
- Eighty-four tests across sixteen files pass, including thirteen new schema
  migration, canonicalization, convergence, conflict, deletion, attachment,
  dismissal, and daily-occurrence tests.

## Checkpoint 13b versioned runtime persistence

- `TaskPersistence` now validates schema v3 or deterministically migrates
  schema v1/schema v2, serializes canonical schema-v3 snapshots, and preserves
  the existing single-process save queue.
- `VersionedTaskStore` is the live mutation boundary. `TaskStore.ts` remains a
  small stable re-export so views, actions, and tests keep their existing
  import path.
- The React UI still receives the established `PluginData`/`TaskRecord` view
  shape. `materializePluginDataV3` filters tombstones and derives task,
  template, attachment, daily-instance, and display-order records.
- Stable lexicographic position keys replace persisted contiguous sibling
  indexes. Reorder and reparent change only the moved task's atomic structure
  group; neighboring tasks retain both key and version.
- Creation, metadata edits, due date/time, completion cascades, Today
  projection, moves, attachment add/remove, completed visibility, daily
  templates, daily occurrences, deletion, and rollover advance the logical
  clock and stamp only their affected atomic groups.
- Subtree deletion retains raw entities and writes one shared logical
  tombstone version for every known descendant. Attachment removal likewise
  retains add metadata behind an attachment tombstone.
- Daily occurrence IDs are deterministic and daily-instance metadata is
  preserved during schema-v2 migration. Daily titles and order remain derived
  from their template.
- A strict schema-v3 parser rejects incomplete records, malformed stamps,
  invalid position keys, clocks behind observed versions, inconsistent
  timestamps, invalid metadata, and duplicate IDs before data reaches the
  store.
- Existing CRUD, navigation, Today, Tree View, attachment, daily, and
  Undo/Redo behavior remains covered without UI changes.
- Ninety-nine tests across nineteen files pass, including fifteen new
  position, parser, materializer, atomic-version, stable-reorder, tombstone,
  attachment, preference, template, and occurrence assertions.
- `isDesktopOnly` remains `true`. External settings reconciliation and
  operation-based Undo/Redo are explicitly deferred to checkpoint 13c.
