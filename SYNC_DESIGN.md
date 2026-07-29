# Miller Tasks mobile synchronization design

Status: accepted revision for free provider-agnostic transport
Date: 2026-07-29

Implementation status: checkpoint 13b makes schema v3 the local runtime
persistence format, and checkpoint 14a enables the responsive mobile beta.
Schema-v1/v2 migration, canonical serialization, stable position keys, logical
field versions, tombstone visibility, deterministic daily occurrence IDs, and
the legacy-compatible UI materializer are active. Undo/Redo now applies fresh
atomic field, tombstone, and intentional-presence versions. Canonical replica
envelopes, version-vector validation, highest-generation selection, and causal
state joins are active. Stable per-vault installation identity, conservative
legacy bootstrap, one-file-per-installation vault persistence, and debounced
vault-event reconciliation are now connected. Daily/attachment arrival
hardening and the physical Dropbox two-device matrix remain.

## Scope

This document defines how Miller Tasks will synchronize task data between
desktop and mobile Obsidian clients and how concurrent changes will converge.
The responsive mobile beta is already enabled, but cross-device editing is
released only after replica persistence, attachment behavior, and the full
two-device test matrix pass.

## Decision summary

- Any service that transfers ordinary vault files may remain the transport.
  Miller Tasks will not add an account, paid dependency, server, network
  client, OAuth flow, or telemetry.
- Shared task state moves from one replaceable plugin `data.json` to one
  ordinary vault replica file per Miller Tasks installation under
  `Miller Tasks/Sync/`.
- Each installation writes only its own replica file. It reads and merges every
  valid replica file, so a provider never has to merge JSON and one device
  cannot overwrite another device's only copy.
- The initial supported free transports are native iCloud Drive for Apple-only
  vaults and Dropbox through the Remotely Save community plugin. The task
  model and merge engine do not contain provider-specific code.
- Schema v3 replaces document-level last-writer-wins behavior with a
  state-based, entity-and-field merge model.
- Every mutable field group receives a causal version stamp from a stable,
  installation-local actor. Replica version vectors determine whether changes
  are sequential or concurrent. Wall-clock time remains useful for task dates
  and display, but never decides conflicts.
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
- An incoming replica merge that materially changes task state clears the
  local Undo/Redo stacks. A no-op echo of the device's own save does not.
- `manifest.json` sets `isDesktopOnly: false` for mobile beta testing.
  Cross-device editing remains explicitly unsupported until the replica test
  matrix passes.

## Why schema v2 is not safe for multiple devices

`TaskPersistence` currently serializes writes made by one plugin process. This
prevents two local saves from overtaking each other, but every save still
writes one complete snapshot containing all tasks and templates.

If desktop and mobile start from the same snapshot, edit different tasks
offline, and later synchronize, a provider can replace one shared file with
either device's version. The final writer can therefore erase a valid
independent change before Miller Tasks has a chance to inspect both versions.
Comparing top-level timestamps would only choose which complete snapshot loses
and would not solve the problem.

Unique replica files remove that transport race. Schema v3 then merges below
the document level after both files arrive.

## Guarantees

When every device eventually receives the same valid replica files, Miller
Tasks will:

1. converge to the same task and template state on every device;
2. retain independent edits to different records or fields;
3. resolve the same-field conflict identically on every device;
4. keep deletion effective after an older offline device reconnects;
5. keep the tree acyclic, connected, and within the 10-level limit;
6. avoid duplicate daily occurrences for the same template and local date;
7. leave local selection, scroll, zoom, drafts, and Undo/Redo out of synced
   state.

Synchronization is asynchronous, not real-time collaboration. Temporary
differences are expected while a provider is transferring files. On iOS,
community sync plugins run only while Obsidian is active.

## Transport and lifecycle

Miller Tasks stores shared files in:

```text
Miller Tasks/
├── Sync/
│   ├── <replica-id>.json
│   └── <another-replica-id>.json
└── Attachments/
    └── <task-id>/...
```

The names are opaque random IDs. No device name, account identifier, email
address, or provider credential enters a replica file.

An installation ID is generated with `crypto.randomUUID()` and retained in
device-local browser storage, namespaced by plugin ID and vault name. It is not
written to a synchronized setting. If local application storage is cleared,
the installation receives a new ID and leaves the old replica file intact;
the state join makes that safe, and explicit replica retirement is future
work.

Every replica file has an envelope:

```ts
interface ReplicaDocument {
  format: "miller-tasks-replica";
  formatVersion: 1;
  replicaId: string;
  generation: number;
  observed: Record<string, number>;
  state: PluginDataV3;
}
```

`generation` orders replacement versions of the same replica file.
`observed` is a version vector keyed by stable actor/replica ID. It records
which actor counters were visible when the file was written. The state remains
the canonical schema-v3 document.

The synchronization coordinator uses these boundaries:

1. On load, scan `Miller Tasks/Sync/*.json` through Obsidian `Vault` APIs,
   validate every envelope, and merge all valid states.
2. Local mutations enter one serialized coordinator, advance the local actor
   counter, apply the mutation, notify views, and queue an immutable write only
   to this installation's replica file.
3. Listen to Obsidian vault `create`, `modify`, `rename`, and `delete` events
   under `Miller Tasks/Sync/`, debounce provider bursts, then rescan the
   complete replica set.
4. Parse and validate files before they can reach the store. A malformed or
   partially delivered file is ignored and retried; it never replaces the last
   valid in-memory state.
5. Merge current memory with incoming replica states and union their version
   vectors inside the same serialized boundary as local writes.
6. A material state merge replaces the store state, reconciles selection,
   clears local history, notifies all views, and writes the merged state to
   the local replica for redundancy.
7. A vector-only or canonical no-op merge does not write. This prevents
   devices from endlessly acknowledging each other's acknowledgement files.

Draft text is flushed into the store before a merge result is committed.
Replica deletion is never interpreted as task deletion; only schema-v3 entity
tombstones delete tasks.

## Schema v3

### Causal field versions

Every installation has one stable random actor ID equal to its replica ID. A
local change advances that actor's counter and uses:

```ts
interface VersionStamp {
  counter: number;
  actorId: string;
}
```

The replica envelope's version vector retains the greatest observed counter
for every actor. A field stamp is causally older when the other replica's
vector contains at least that counter for its actor. Two different field
values are concurrent only when neither replica has observed the other's
stamp. Concurrent winners compare by `counter`, then by `actorId`, solely as a
deterministic tie-breaker.

Existing schema-v3 actor IDs remain valid during migration. The first replica
envelope seeds its vector with the maximum counter observed for every legacy
actor. Future local changes use the stable installation actor.

`PluginDataV3.clock` remains the maximum informational counter present in the
state for backward-compatible validation and canonicalization. It no longer
implies causality across different actors.

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

The canonical state join is pure, commutative, associative, and idempotent for
valid schema-v3 documents plus their replica version vectors. Causality comes
from the vectors rather than a last reconciled snapshot, so conflict detection
still works after an app restart.

1. Union entities and tombstones by stable ID.
2. Apply entity tombstones.
3. For every surviving entity, compare each atomic field group independently.
4. Equal field stamps and values collapse to one value.
5. If one replica's vector has observed the other field stamp, the causal
   successor wins without a conflict.
6. If neither vector has observed the other stamp, two different values are
   concurrent and create one deduplicated conflict record. Stamp comparison
   selects the temporary visible winner.
7. If malformed inputs claim mutual observation while retaining different
   values, select deterministically, preserve the losing value, and record a
   corruption conflict rather than discarding data.
8. Merge attachment add entries and attachment tombstones by attachment ID.
9. Repair the hierarchy.
10. Derive parent completion from surviving direct children.
11. Sort records canonically before hashing and saving.

Conflict IDs are derived from entity ID, field group, and the two version
stamps, so repeated delivery of the same snapshots cannot create duplicates.

## Conflict policy

| Conflict | Result |
| --- | --- |
| Different tasks changed | Keep both changes |
| Different fields of one task changed | Combine the fields |
| Same field changed to the same value | Collapse to one value |
| Same field changed differently | Causal successor wins; if concurrent, a deterministic stamp winner is visible and the other value is preserved |
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
Any material incoming replica merge clears both stacks. Daily rollover and
attachment filesystem changes retain their existing history barriers.

## Invalid data and failure behavior

- An invalid replica never replaces valid in-memory task state.
- The plugin quarantines that replica from the current merge, shows a
  persistent English Notice, and offers a recovery/export command instead of
  overwriting the invalid file.
- Parse, migration, merge, hierarchy repair, and canonical serialization are
  tested independently.
- A failed save keeps the last durable snapshot identifiable and surfaces an
  error. Retry uses the same logical versions rather than inventing duplicate
  changes.
- The user's provider version history or a separate vault backup remains the
  recovery path for complete file corruption. Synchronization is not a backup.

## Replica-file transport safety

File synchronization providers still transfer each JSON file as a whole. The
critical difference is ownership: only the replica named by this installation
is ever modified locally. Desktop and mobile therefore produce different
paths, and a last-writer-wins provider never chooses between their only copies.

A provider conflict copy with a recognizable JSON envelope is treated as
another delivery of the declared replica. The highest valid `generation` for
that replica is primary; divergent same-generation documents are both merged
and produce a corruption conflict. The plugin never deletes conflict copies
automatically.

Material incoming state is absorbed into the local replica after merge. This
provides redundancy without an acknowledgement loop because a vector-only
change does not trigger another write.

The inactive-device release test remains mandatory: both devices edit offline,
one closes, the other synchronizes first, and both later reconnect. The test
passes only if both unique replica files arrive and converge without recovery
from provider history.

## Dropbox through Remotely Save

Miller Tasks does not call Dropbox APIs. Users install Remotely Save separately
on each Obsidian device and authorize that plugin to use Dropbox. Miller Tasks
requires Remotely Save to include:

```text
Miller Tasks/Sync/
Miller Tasks/Attachments/
```

Both are ordinary vault folders, so Remotely Save's default exclusion of the
`.obsidian` configuration directory does not exclude task replicas or images.
Miller Tasks itself never reads Remotely Save settings or credentials.

For the first-device bootstrap:

1. upgrade and open Miller Tasks on the device that currently has the complete
   task set;
2. wait for its first replica file to be written;
3. run Remotely Save upload on that device;
4. install Miller Tasks and Remotely Save on the second device;
5. download the vault, open Miller Tasks, and verify task counts before editing;
6. thereafter synchronize before and after offline work, or enable Remotely
   Save's supported in-app schedule.

Remotely Save cannot run continuously while Obsidian is suspended on iOS.
Miller Tasks must therefore tolerate delayed files and never claim real-time
sync. Users must not run iCloud and Remotely Save against the same vault at the
same time.

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

The replica transport then migrates schema v3 conservatively:

1. load and validate the existing plugin `data.json`;
2. scan and validate any already-delivered replica files;
3. if this installation has no replica, merge the legacy state with all valid
   replicas and write the result to a new installation-owned replica file;
4. seed the replica version vector from every version stamp in the merged
   state;
5. switch new durable mutations to the replica only after that write succeeds;
6. leave `data.json` intact as a frozen migration fallback during the first
   release rather than deleting or rewriting user data.

Once the local replica exists, later startup scans treat replica files as
authoritative and do not repeatedly import the frozen legacy snapshot.
Upgrading a device after its old shared `data.json` was already overwritten
cannot recover data that never reached the migration code; release instructions
therefore require upgrading the device with the complete task set first.

## Implementation sequence

1. Keep the completed schema-v3 types, canonical serialization, tombstones,
   deterministic migration, stable positions, and versioned runtime store.
2. Keep the completed responsive mobile beta available for single-device
   testing.
3. Keep the completed freshly versioned Undo/Redo inverse operations.
4. Keep the completed replica envelope, version-vector validation,
   highest-generation selection, stable installation identity, legacy
   bootstrap, and one-file-per-installation persistence.
5. Keep the completed serialized vault-event coordinator, material-merge
   history reset, invalid-file quarantine, and no-op write suppression.
6. Complete deterministic daily occurrence and attachment file-arrival
   reconciliation.
7. Run the two-device offline, reconnect, inactive-device, deletion,
   hierarchy, daily rollover, and attachment matrix through a local simulated
   provider.
8. Run the same matrix with Dropbox through Remotely Save on macOS and iOS.
9. Complete physical-device touch and lifecycle QA.

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
- one device remains closed while the other synchronizes its divergent
  replica;
- the same replica arrives through create, modify, rename, duplicate conflict
  copy, and out-of-order generation delivery;
- Dropbox/Remotely Save sync is manually interrupted and resumed on both
  macOS and iOS;
- plugin reload occurs during a queued local save and an incoming sync;
- Undo follows a remote merge and cannot erase the imported change.

## Official platform constraints

The implementation follows the current Obsidian guidance:

- use `Plugin.loadData()` only for the legacy `data.json` bootstrap;
- use ordinary vault files and registered `Vault` events for replica state;
- use `Platform` instead of Node or Electron platform detection;
- keep vault file work behind Obsidian `Vault` and `FileManager` APIs;
- use no top-level Node.js, Electron, or `FileSystemAdapter` dependency on
  mobile.

References:

- <https://docs.obsidian.md/Reference/Manifest>
- <https://docs.obsidian.md/oo/plugin>
- <https://obsidian.md/help/sync-notes>
- <https://github.com/remotely-save/remotely-save>
