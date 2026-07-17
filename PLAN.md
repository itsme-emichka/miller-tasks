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
- [ ] 7. Polish both Obsidian themes, keyboard and focus behavior, finish
      documentation, run full QA, and prepare beta artifacts.

## Product constraints

- One task tree, with root tasks at depth 1 and a maximum depth of 10.
- Desktop-only, English UI, one shared heading, unlabelled columns, a uniform
  Obsidian background, and no decorative interface elements.
- The task inspector is a separate ItemView in Obsidian's collapsible right
  sidebar and never consumes space inside the column browser.
- JSON persistence through the Obsidian plugin data API.
- Manual ordering and drag-and-drop moves.
- Completed tasks hidden by default and available through a global toggle.
- No recurrence, reminders, time zones, smart lists, multiple lists, search,
  arbitrary properties, or mobile UI in v1.

## Current checkpoint

Checkpoint 6 is complete. The next work is checkpoint 7: keyboard and theme
polish, final documentation, full vault QA, and beta artifacts.
