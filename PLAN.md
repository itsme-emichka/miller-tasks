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
- [x] 13b. Replace contiguous sibling indexes with stable position keys and
      version every store mutation at its atomic field boundary.
- [x] 13c. Replace the paid/shared-file transport design with free,
      provider-agnostic per-installation replica files inside the ordinary
      vault, stable local actors, and causal version vectors.
- [x] 13d. Replace snapshot-restoring Undo/Redo with freshly versioned local
      inverse operations before accepting replica merges.
- [x] 13e1. Add canonical replica envelopes, version-vector validation,
      highest-generation selection, and causal merge tests.
- [x] 13e2. Implement conservative legacy bootstrap and per-installation
      replica persistence through Obsidian vault files.
- [x] 13e3. Reconcile replica create/modify/rename/delete events through one
      serialized coordinator with invalid-file quarantine and history reset.
- [ ] 13f. Synchronize deterministic daily occurrences and attachment
      metadata/file arrival safely through replica files.
- [x] 13g1. Pass the physical Dropbox/Remotely Save macOS-to-iPhone matrix for
      initial transfer plus create, edit, and delete propagation without a
      paid service.
- [ ] 13g2. Pass the remaining two-device offline, inactive-device, and
      same-field conflict/resurrection matrix through the selected free
      Dropbox transport.
- [x] 14a. Audit runtime mobile APIs, add the responsive phone presentation,
      compact Today disclosure, press-and-hold inspector popup, narrow desktop
      fallback, and set `isDesktopOnly` to `false` for beta testing.
- [x] 14a1. Replace the stacked compact Today section with a draggable bottom
      sheet that peeks from the lower edge, snaps at 80% screen height, and
      leaves the horizontal Miller viewport full-height.
- [x] 14a2. Keep the compact Today sheet above Obsidian's measured mobile
      navbar and contain Today/hierarchy touch gestures so they cannot invoke
      the command palette or mobile sidebars.
- [x] 14a3. Let task titles wrap to additional lines in Miller columns and
      Today while keeping each checkbox and Today control aligned to the first
      line.
- [x] 14a4. Fit the compact task inspector between the device safe areas and
      keep its long form inside an independently scrolling modal viewport.
- [x] 14a5. Add the completed-task disclosure to desktop Today, initially
      expanded there while preserving compact Today's initially collapsed
      behavior.
- [x] 14a6. Add a compact daily-task editor disclosure at the top of the
      expanded Today sheet with create, rename, and confirmed delete support.
- [x] 14b. Publish an installable `0.1.0` GitHub beta release with the three
      Obsidian assets so the mobile build can be installed through BRAT.
- [x] 14b1. Publish the replica-synchronization beta as GitHub prerelease
      `0.1.1` so existing BRAT installations can update on Mac and iPhone.
- [x] 14b2. Publish the compact Today bottom-sheet redesign as GitHub
      prerelease `0.1.2` for physical iPhone and narrow-window testing.
- [x] 14b3. Publish the mobile navbar and gesture-containment fixes as GitHub
      prerelease `0.1.3` for BRAT retesting on iPhone.
- [x] 14b4. Publish multi-line task rows, safe-area inspector sizing, desktop
      Today completed disclosure, and compact daily editing as GitHub
      prerelease `0.1.4`.
- [ ] 14c. Complete physical iPhone touch QA, choose a mobile-safe reorder
      gesture that does not block horizontal scrolling, and verify attachment
      import/open/trash behavior on iOS.

## Product constraints

- One task tree, with root tasks at depth 1 and a maximum depth of 10.
- English UI, one shared heading, unlabelled columns, a uniform Obsidian
  background, and no decorative interface elements. Desktop behavior remains
  unchanged while phone and tablet layouts are added behind the same task
  model.
- Every task is a plain Obsidian checkbox followed by text, never a visually
  styled button or card.
- On desktop, the task inspector is a separate ItemView in Obsidian's
  collapsible right sidebar. In compact mode, it opens as a native Obsidian
  popup only after a press-and-hold gesture.
- Current local JSON persistence uses the Obsidian plugin data API. Shared
  synchronization will use ordinary per-installation replica files inside the
  vault so the transport can be iCloud, Dropbox, or another file synchronizer.
- Provider-agnostic mobile synchronization through versioned schema-v3 task
  state, durable deletion tombstones, deterministic field-level merges, and no
  required paid account or Miller Tasks server.
- A pinned Today projection shares the original task records; daily templates
  create isolated instances that reset at local midnight.
- Manual ordering and drag-and-drop moves.
- Tasks completed today stay struck through in the tree; older completed tasks
  are hidden by default and available through a global toggle.
- No recurrence, reminders, timezone conversion, smart lists, multiple lists,
  search, arbitrary properties, custom sync account, or Miller Tasks server.

## Current checkpoint

Checkpoints 13c through 13e3 are complete. The responsive mobile beta is
available through BRAT, and each installation now owns one ordinary
`Miller Tasks/Sync/<replica-id>.json` file. Causal version vectors distinguish
sequential edits from true conflicts, while Undo/Redo emits fresh atomic
versions instead of restoring obsolete synchronization metadata. Checkpoint
13g1 also passed on physical macOS and iPhone installations through free
Dropbox/Remotely Save transport: initial download, phone creation, Mac editing,
and phone deletion all propagated in both directions while two valid replica
files remained independent. Checkpoint 14a1 replaces the stacked mobile Today
section with a native-theme bottom sheet, leaving the hierarchy full-height
and horizontally scrollable behind it. Physical iPhone QA exposed collisions
with Obsidian's floating navbar, pull-down quick action, and edge sidebar
gesture; checkpoint 14a2 measures the navbar overlap and contains the sheet
and hierarchy gestures inside Miller Tasks. Version `0.1.4` adds the physical
QA follow-ups from checkpoints 14a3 through 14a6: wrapping rows, safe-area
inspector sizing, a desktop Today disclosure, and compact daily editing. Next,
complete that iPhone UI retest, then daily/attachment arrival hardening and
the offline and inactive-device conflict matrix.
