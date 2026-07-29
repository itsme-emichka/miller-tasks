# Miller Tasks mobile synchronization design

Status: accepted implementation plan
Date: 2026-07-29

## Scope

This document defines how Miller Tasks will synchronize task data between
desktop and mobile Obsidian clients and how concurrent changes will converge.
It does not implement the mobile layout. Mobile compatibility is enabled only
after the synchronization model, attachment behavior, and touch UI pass the
two-device test matrix.

## Decision summary

- Obsidian or another vault synchronization service remains the transport.
  Miller Tasks will not add an account, server, network client, or telemetry.
- Task state remains in the plugin's `data.json` and is accessed only through
  `Plugin.loadData()` and `Plugin.saveData()`.
- Schema v3 replaces document-level last-writer-wins behavior with a
  state-based, entity-and-field merge model.
- Every mutable field group receives a logical version stamp. Wall-clock time
  remains useful for task dates and display, but never decides conflicts.
- Deletions are durable tombstones. Missing records are not interpreted as
  deletions.
- Sibling order uses stable position keys instead of contiguous integer
  indices, so moving one task does not rewrite every sibling.
- Concurrent changes to different fields are combined. Concurrent changes to
  the same field use one deterministic winner and preserve the losing value in
  a conflict record until the user dismisses or restores it.
- Tree validity is repaired deterministically after every merge. No merge may
  expose a cycle, a missing parent, or a depth greater than 10.
- Undo/Redo remains device-local and memory-only. An Undo or Redo action is
  persisted as a new versioned task change rather than restoring old sync
  metadata.
- External synchronization that materially changes task state clears the
  local Undo/Redo stacks. A no-op echo of the device's own save does not.
- `manifest.json` keeps `isDesktopOnly: true` until the synchronization engine
  and the mobile compatibility audit are complete.

## Why schema v2 is not safe for multiple devices

`TaskPersistence` currently serializes writes made by one plugin process. This
prevents two local saves from overtaking each other, but every save still
writes one complete snapshot containing all tasks and templates.

If desktop and mobile start from the same snapshot, edit different tasks
offline, and later synchronize, the sync provider can replace the complete
file with either device's version. The final writer can therefore erase a
valid independent change. Comparing top-level timestamps would only choose
which complete snapshot loses and would not solve the problem.

Schema v3 must merge below the document level before it writes a reconciled
snapshot.

## Guarantees

When every device eventually receives the same valid snapshots, Miller Tasks
will:

1. converge to the same task and template state on every device;
2. retain independent edits to different records or fields;
3. resolve the same-field conflict identically on every device;
4. keep deletion effective after an older offline device reconnects;
5. keep the tree acyclic, connected, and within the 10-level limit;
6. avoid duplicate daily occurrences for the same template and local date;
7. leave local selection, scroll, zoom, drafts, and Undo/Redo out of synced
   state.

Synchronization is asynchronous, not real-time collaboration. Temporary
differences are expected while a provider is transferring files.

## Transport and lifecycle

Miller Tasks is provider-agnostic. Obsidian Sync users must enable vault
configuration synchronization for the installed plugin and its data. Users of
another provider must include the vault configuration directory and the
`Miller Tasks/Attachments` folder.

The plugin ID and installed folder name must both remain `miller-tasks`, which
is required for Obsidian to deliver external settings notifications reliably.

The synchronization coordinator uses these boundaries:

1. Local mutations enter one serialized coordinator.
2. The coordinator advances the logical clock, applies the mutation, notifies
   the views, and queues an immutable snapshot for `Plugin.saveData()`.
3. `Plugin.onExternalSettingsChange()` captures the externally supplied
   snapshot through `Plugin.loadData()`.
4. The external snapshot is parsed and validated before it can reach the
   store.
5. The coordinator merges the current in-memory state, the incoming state, and
   the last reconciled base.
6. A material merge replaces the store state, reconciles selection, clears
   local history, notifies all views, and saves the canonical merged snapshot.
7. A canonical content fingerprint suppresses save-notification echo loops.

Capturing the incoming file and merging it must share the same serialized
boundary as local writes. Draft text is flushed into the store before the
merge result is committed.

## Schema v3

### Logical versions

Every plugin load creates a random actor ID. The document stores the maximum
logical counter observed. A local change uses:

```ts
interface VersionStamp {
  counter: number;
  actorId: string;
}
```

The next counter is one greater than the maximum counter in the current merged
document. Stamps compare by `counter`, then by `actorId`. The actor ID is a
deterministic tie-breaker only; it does not identify a user and is not used for
analytics.

Epoch millisecond values such as `createdAt`, `updatedAt`, and `completedAt`
retain their product meaning. They are not conflict clocks because device
clocks may differ.

### Task fields

Task identity and creation metadata are immutable after creation. Mutable
values are versioned in atomic field groups:

| Field group | Values |
| --- | --- |
| `title` | `title` |
| `description` | `description` |
| `tags` | complete normalized tag list |
| `due` | `dueDate`, `dueTime` |
| `priority` | `priority` |
| `flag` | `flagged` |
| `url` | `url` |
| `completion` | `completed`, `completedAt` |
| `today` | `today`, `todayAddedAt` |
| `structure` | `parentId`, `positionKey` |

Due date and time share one stamp so a merge cannot attach an old time to a new
date. Completion and Today timestamps likewise travel with their booleans.
`updatedAt` becomes the maximum informational edit time in the merged record.

Tags remain one normalized list for the first mobile release. A concurrent
replacement of that same list is a visible conflict; it is not treated as an
add/remove set.

### Stable ordering

The contiguous integer `order` field is replaced by `positionKey`. A new key is
generated between its neighboring keys and includes a unique suffix when
needed. Records sort by `positionKey`, then by stable record ID.

Moving a task changes the atomic `structure` group. Concurrent moves of
different tasks combine. Concurrent moves of the same task use the normal
same-field conflict rule. Position-key compaction is not part of the first
mobile release because rewriting every sibling would recreate the conflict
surface this design removes.

### Deletions and intentional restore

Task and template deletion creates tombstones:

```ts
interface EntityTombstone {
  id: string;
  deleted: VersionStamp;
  deletedAt: number;
}
```

A tombstone wins over field updates because editing a field does not change
entity existence. An explicit local Undo may restore a deletion without
trashed attachments by writing a newer `present` existence stamp. This is the
only path that reuses a tombstoned task ID; an old offline record has no newer
existence stamp and cannot resurrect itself.

Tombstones are retained indefinitely in the first mobile release. Removing
them by age would allow a long-offline device to resurrect deleted tasks.
Future garbage collection requires explicit replica acknowledgement and device
retirement.

Deleting a branch creates a tombstone for every descendant known on that
device. A task concurrently created under that branch has a new ID and is not
silently deleted; after merge it is rescued to the root and produces a
conflict record.

### Attachments

Attachments are an add/remove set keyed by attachment ID:

- adding an image creates the vault file first, then writes a versioned
  attachment entry;
- removing an image writes an attachment tombstone and uses Obsidian trash;
- an attachment tombstone wins over an older add for the same ID;
- a metadata entry may arrive before its file, so the UI shows a non-destructive
  `Syncing image…` placeholder and retries on vault file events;
- a temporarily missing file never causes metadata deletion;
- removing a task tombstones all recorded attachment entries before its files
  are trashed.

Attachment paths remain
`Miller Tasks/Attachments/<task-id>/<attachment-id>-<safe-name>` and are
synchronized as ordinary vault files. Image operations remain Undo/Redo safety
barriers because filesystem trash cannot be reliably reversed by task history.

### Daily templates and occurrences

Templates use versioned title and position groups plus template tombstones.

Generated daily instances are replaced with deterministic occurrences keyed by
template ID and local calendar date:

```text
<template-id>:<YYYY-MM-DD>
```

Two devices on the same local date therefore edit the same occurrence instead
of creating duplicate random task IDs. Devices in different calendar dates
may temporarily show different occurrences, which is correct because the
existing product definition uses local dates.

Occurrence completion is synchronized. The visible title and ordering are
derived from the current template. The first mobile release retains occurrence
state; pruning it safely requires the same acknowledged-replica protocol as
tombstone garbage collection.

Normal Today membership remains a versioned property of the original task.
The 24-hour completed retention is evaluated from the absolute `completedAt`
timestamp on each device.

### Presentation and local state

The following state is never synchronized:

- Undo and Redo entries;
- focused task and selected ancestry path;
- pending text drafts;
- open view type and inspector visibility;
- Miller column scroll;
- Tree View scroll and zoom;
- temporary sync notices.

`showCompleted` remains a shared, independently versioned plugin preference in
schema v3 unless a later mobile usability test demonstrates that desktop and
mobile require independent values.

## Merge algorithm

The canonical two-way state join is pure, commutative, associative, and
idempotent for valid schema-v3 documents. The last reconciled base is used only
to recognize concurrency and preserve a losing value; it does not change the
canonical winner.

1. Union entities and tombstones by stable ID.
2. Apply entity tombstones.
3. For every surviving entity, compare each atomic field group independently.
4. Use the higher logical stamp when only canonical state is available.
5. When a last reconciled base is available:
   - one changed side beats one unchanged side;
   - equal changes collapse to one value;
   - two different changes are concurrent and create one deduplicated conflict
     record;
   - the logical-stamp comparison selects the temporary visible winner.
6. Merge attachment add entries and attachment tombstones by attachment ID.
7. Repair the hierarchy.
8. Derive parent completion from surviving direct children.
9. Sort records canonically before hashing and saving.

Conflict IDs are derived from entity ID, field group, and the two version
stamps, so repeated delivery of the same snapshots cannot create duplicates.

## Conflict policy

| Conflict | Result |
| --- | --- |
| Different tasks changed | Keep both changes |
| Different fields of one task changed | Combine the fields |
| Same field changed to the same value | Collapse to one value |
| Same field changed differently | Higher stamp is visible; preserve the other value in a conflict record |
| Edit versus delete of the same entity | Delete wins; preserve the edited snapshot in a conflict record |
| Two moves of the same task | Higher structure stamp wins; preserve the other destination |
| New task points to a deleted parent | Move the new task to root and record the repair |
| Concurrent moves create a cycle | Keep the higher-priority structural edge and move the other task to root |
| Merge exceeds depth 10 | Move the lower-priority conflicting subtree to root |
| Attachment metadata arrives before file | Keep metadata and show a syncing placeholder |
| Attachment remove versus older add | Remove wins |

Conflict records are synchronized until resolved. Resolving or dismissing one
writes a conflict-record tombstone so an old device cannot reintroduce it. The
plugin shows one concise Notice after a merge and exposes a command to review
conflicts. It never opens a modal automatically. Applying a losing value
creates a fresh local mutation with a new stamp. Restoring an entity from a
sync conflict creates a new task ID at the root; only a direct local Undo may
reuse an ID by writing a newer existence stamp.

## Hierarchy repair

Every device runs the same repair pass after merge:

1. remove tombstoned records;
2. rescue surviving records whose parent is missing or deleted to the root;
3. detect strongly connected components and break each cycle using the
   deterministic structure-stamp ordering;
4. calculate depths from roots;
5. detach the lower-priority conflicting subtree until every depth is at most
   10;
6. sort each sibling set by `positionKey` and task ID;
7. derive branch completion from surviving children.

Repair never deletes a surviving task. Every non-trivial repair produces a
conflict record so the user can understand why a task moved.

## Undo and Redo

Schema-v2 history restores full snapshots, which would also restore obsolete
version stamps and could resurrect remote deletions. Schema v3 changes history
entries to user-level inverse operations:

- Undo writes the prior field value with a new stamp.
- Redo writes the later field value with a new stamp.
- Create Undo writes a tombstone; Redo writes a newer intentional-presence
  stamp for that same ID.
- Delete Undo writes a newer intentional-presence stamp only when no attachment
  file was trashed.
- Reorder and reparent Undo write a new structure version.

The stacks remain bounded to 100 entries in memory and are never serialized.
Any material external merge clears both stacks. Daily rollover and attachment
filesystem changes retain their existing history barriers.

## Invalid data and failure behavior

- An invalid external snapshot never replaces valid in-memory task state.
- The plugin pauses further persistence, shows a persistent English Notice,
  and offers a recovery/export command instead of overwriting the invalid file.
- Parse, migration, merge, hierarchy repair, and canonical serialization are
  tested independently.
- A failed save keeps the last durable snapshot identifiable and surfaces an
  error. Retry uses the same logical versions rather than inventing duplicate
  changes.
- Obsidian Sync settings history or the user's provider history remains the
  recovery path for complete file corruption. Synchronization is not a backup.

## Whole-file transport limitation

Obsidian and third-party sync services transfer `data.json` as a whole file.
The merge engine protects divergent snapshots that reach a running Miller
Tasks instance, but it cannot make an unavailable version appear.

Before mobile release, the two-device QA matrix must include an inactive-device
overwrite test: both devices edit offline, one device closes before sync, and
the other synchronizes first. If either valid branch cannot be delivered back
to the plugin by Obsidian Sync and recovered through the merge path, task state
must move to unique per-replica vault files before `isDesktopOnly` is changed.
This is a release gate, not an accepted data-loss risk.

## Migration

Schema v1 continues to migrate through schema v2. Schema v2 then migrates
deterministically to schema v3:

1. existing task and template IDs are preserved;
2. mutable field groups receive the shared baseline stamp
   `{ counter: 0, actorId: "migration" }`;
3. integer sibling orders become evenly spaced stable position keys;
4. current daily instances become deterministic template/date occurrences;
5. empty tombstone and conflict collections are added;
6. the migrated document is fully validated before the first schema-v3 save.

Migration must be idempotent and produce byte-equivalent canonical data on
desktop and mobile.

## Implementation sequence

1. Add schema-v3 types, canonical serialization, stamps, tombstones, and
   deterministic v2 migration.
2. Add pure three-way merge tests for every conflict row in this document.
3. Replace integer sibling ordering with stable position keys.
4. Make store mutations generate versioned field changes and operation-based
   Undo/Redo entries.
5. Add the external-settings coordinator, echo suppression, conflict records,
   and history reset.
6. Convert daily instances to deterministic occurrences.
7. Add attachment synchronization placeholders and file-event reconciliation.
8. Run the two-device offline, reconnect, inactive-overwrite, deletion,
   hierarchy, daily rollover, and attachment matrix.
9. Audit every dependency and API for iOS and Android compatibility, implement
   the mobile layout, then set `isDesktopOnly` to `false`.

## Release test matrix

The mobile flag remains blocked until these cases converge without task loss:

- desktop and mobile create different root tasks offline;
- both edit different fields of one task;
- both edit the same title and description;
- one completes while the other edits metadata;
- one deletes while the other edits or creates a child;
- concurrent reorder and reparent operations create a potential cycle or
  depth-11 path;
- both roll over the same daily template;
- devices are on different local calendar dates;
- image metadata and image files arrive in either order;
- one device remains closed while the other synchronizes a divergent file;
- plugin reload occurs during a queued local save and an incoming sync;
- Undo follows a remote merge and cannot erase the imported change.

## Official platform constraints

The implementation follows the current Obsidian guidance:

- use `Plugin.loadData()` and `Plugin.saveData()` for `data.json`;
- respond to `Plugin.onExternalSettingsChange()` rather than polling or reading
  the plugin directory directly;
- use `Platform` instead of Node or Electron platform detection;
- keep vault file work behind Obsidian `Vault` and `FileManager` APIs;
- use no top-level Node.js, Electron, or `FileSystemAdapter` dependency on
  mobile.

References:

- <https://docs.obsidian.md/Reference/Manifest>
- <https://docs.obsidian.md/oo/plugin>
- <https://obsidian.md/help/Obsidian%2BSync/Set%2Bup%2BObsidian%2BSync>
- <https://help.obsidian.md/Obsidian%2BSync/Version%2Bhistory>
