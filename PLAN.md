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

## Product constraints

- One task tree, with root tasks at depth 1 and a maximum depth of 10.
- Desktop-only, English UI, one shared heading, unlabelled columns, a uniform
  Obsidian background, and no decorative interface elements.
- Every task is a plain Obsidian checkbox followed by text, never a visually
  styled button or card.
- The task inspector is a separate ItemView in Obsidian's collapsible right
  sidebar and never consumes space inside the column browser.
- JSON persistence through the Obsidian plugin data API.
- A pinned Today projection shares the original task records; daily templates
  create isolated instances that reset at local midnight.
- Manual ordering and drag-and-drop moves.
- Tasks completed today stay struck through in the tree; older completed tasks
  are hidden by default and available through a global toggle.
- No recurrence, reminders, time zones, smart lists, multiple lists, search,
  arbitrary properties, or mobile UI in v1.

## Current checkpoint

Checkpoint 11 is complete. Miller columns and the structured top-down Tree
View are both available as native Obsidian ItemViews.
