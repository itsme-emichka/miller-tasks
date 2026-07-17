# Miller Tasks implementation plan

This file is the source of truth for checkpoint status. Every checkpoint ends
with verification, one commit, one push to `main`, a result report, and a hard
pause until the user says **continue**.

## Checkpoints

- [x] 1. Bootstrap the plugin, visual shell, test harness, CI, development
      vault, project documentation, and public GitHub repository.
- [ ] 2. Add the task domain model, validated persistent store, CRUD, tree
      invariants, completion/deletion cascades, and unit tests.
- [ ] 3. Build Miller column navigation, task creation, inline rename,
      completion controls, and completed-task visibility.
- [ ] 4. Add the persistent inspector, metadata fields, autosave, validation,
      and overdue state.
- [ ] 5. Add ordering, cross-column drag-and-drop, tree moves, and destructive
      action confirmations.
- [ ] 6. Add pasted and dropped image attachments, previews, opening, and
      confirmed trash behavior.
- [ ] 7. Polish both Obsidian themes, keyboard and focus behavior, finish
      documentation, run full QA, and prepare beta artifacts.

## Product constraints

- One task tree, with root tasks at depth 1 and a maximum depth of 10.
- Desktop-only, English UI, Obsidian-native appearance with Finder-like
  hierarchy cues.
- JSON persistence through the Obsidian plugin data API.
- Manual ordering and drag-and-drop moves.
- Completed tasks hidden by default and available through a global toggle.
- No recurrence, reminders, time zones, smart lists, multiple lists, search,
  arbitrary properties, or mobile UI in v1.

## Current checkpoint

Checkpoint 1 is complete. The next authorized work is checkpoint 2:
the task domain model and persistent store.
