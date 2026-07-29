# Miller Tasks implementation plan

This file is the source of truth for checkpoint status. Every checkpoint ends
with verification, one commit, and one push to `main`. Development continues
automatically while all checks are green.

## Checkpoints

- [x] 1. Bootstrap the plugin, visual shell, test harness, CI, development
      vault, project documentation, and public GitHub repository.
- [x] 1a. Replace the original visual shell with one shared heading, unlabelled
      columns, a uniform background, and a native right-sidebar inspector.
- [x] 2. Add the task domain model, validated persistent store, CRUD, tree
      invariants, completion/deletion cascades, and unit tests.
- [x] 3. Build Miller column navigation, task creation, inline rename,
      completion controls, and completed-task visibility.
- [x] 4. Add task details to the native right-sidebar inspector, metadata
      fields, autosave, validation, and overdue state.
- [x] 5. Add ordering, cross-column drag-and-drop, tree moves, and destructive
      action confirmations.
- [x] 6. Add pasted and dropped image attachments, previews, opening, and
      confirmed trash behavior.
- [x] 7. Polish both Obsidian themes, keyboard and focus behavior, finish
      documentation, run full QA, and prepare beta artifacts.
- [x] 7a. Replace task title buttons with native-looking checkbox-and-text
      rows while preserving selection, keyboard, and drag behavior.
- [x] 7b. Remove automatic column scrolling so horizontal viewport movement is
      exclusively controlled by the user.
- [x] 8. Upgrade to schema v2 with Today markers, 24-hour completed retention,
      daily templates, and local-day instance rollover.
- [x] 9a. Add the pinned Today projection and inline calendar icon without
      moving the manually controlled Miller viewport.
- [x] 9b. Add minimal daily-template controls to the native right-sidebar
      inspector.
- [x] 9c. Add the rollover scheduler, run full QA, and finish documentation.
- [x] 10a. Keep daily instances below ordinary Today tasks and separate the
      two groups with a single theme-native hairline.
- [x] 10b. Project leaf descendants into Today and derive parent completion
      from completed children.
- [x] 10c. Keep newly completed tree rows visible until the next local day.
- [x] 10d. Expose confirmed subtree deletion directly in the native task
      inspector.
- [x] 10e. Delete a focused task row with Delete or Backspace, confirming only
      when the task owns a subtree.
- [x] 10f. Replace the selected-path side stripe with accent-colored,
      underlined task text.
- [x] 10g. Underline only the current task while keeping its selected
      ancestors accent-colored without underlines.
- [x] 10h. Show a subtle direct-parent caption below subtasks in Today.
- [x] 10i. Move completed tasks below incomplete peers inside each Today
      section.
- [x] 11a. Add a deterministic top-down layout engine for the complete task
      forest.
- [x] 11b. Build and register the interactive structured Tree View.
- [x] 11c. Add one icon beside the shared heading that switches the current
      Obsidian leaf between Miller columns and Tree View.
- [x] 11d. Add manual Tree View zoom controls and fit-to-viewport.
- [x] 12. Add bounded session-local Undo/Redo for task mutations, Obsidian
      commands, and view-scoped keyboard shortcuts.
- [x] 12a. Keep Undo/Redo active after deleting the focused DOM row.
- [x] 13. Design the mobile synchronization, conflict, migration, attachment,
      daily-occurrence, and release-gate strategy.
- [x] 13a. Add schema-v3 version stamps, tombstones, canonical serialization,
      deterministic schema-v2 migration, and pure merge tests.
- [ ] 13b. Replace contiguous sibling indexes with stable position keys and
      version every store mutation at its atomic field boundary.
- [ ] 13c. Add external-settings reconciliation, conflict records, save-echo
      suppression, and operation-based local Undo/Redo.
- [ ] 13d. Synchronize deterministic daily occurrences and attachment
      metadata/file arrival safely.
- [ ] 13e. Pass the two-device offline and inactive-overwrite release matrix.
- [ ] 14. Audit mobile APIs and dependencies, implement the phone/tablet
      presentation, and set `isDesktopOnly` to `false`.

## Product constraints

- One task tree, with root tasks at depth 1 and a maximum depth of 10.
- English UI, one shared heading, unlabelled columns, a uniform Obsidian
  background, and no decorative interface elements. Desktop behavior remains
  unchanged while phone and tablet layouts are added behind the same task
  model.
- Every task is a plain Obsidian checkbox followed by text, never a visually
  styled button or card.
- The task inspector is a separate ItemView in Obsidian's collapsible right
  sidebar and never consumes space inside the column browser.
- JSON persistence through the Obsidian plugin data API.
- Provider-agnostic mobile synchronization through versioned schema-v3 task
  state, durable deletion tombstones, and deterministic field-level merges.
- A pinned Today projection shares the original task records; daily templates
  create isolated instances that reset at local midnight.
- Manual ordering and drag-and-drop moves.
- Tasks completed today stay struck through in the tree; older completed tasks
  are hidden by default and available through a global toggle.
- No recurrence, reminders, timezone conversion, smart lists, multiple lists,
  search, arbitrary properties, custom sync account, or Miller Tasks server.

## Current checkpoint

Checkpoint 13a is complete. The isolated schema-v3 domain layer now provides
logical stamps, tombstones, canonical serialization, deterministic migration,
field-level state merging, and conflict records without changing runtime
schema-v2 persistence. Next, replace contiguous sibling indexes with stable
position keys and version every store mutation.
