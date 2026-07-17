# Miller Tasks

Miller Tasks is a desktop task tracker for Obsidian. It will turn a deeply
nested task tree into a horizontal Miller columns browser with task details in
Obsidian's native right sidebar.

> Development status: checkpoint 5 of 7 is complete. Interactive columns,
> sidebar metadata, drag-and-drop tree moves, ordering, and confirmed subtree
> actions are working.

## Planned experience

- Navigate up to ten levels of tasks without losing the current path.
- Keep direct subtasks in the next column.
- Edit task details in Obsidian's collapsible right sidebar.
- Store descriptions, tags, local due dates, priority, flags, URLs, and images.
- Reorder and move tasks with drag-and-drop.
- Highlight incomplete overdue tasks.

The v1 scope intentionally excludes recurring tasks, reminders, time zones,
smart lists, search, custom properties, and mobile support.

## Development

Requirements:

- Node.js 22 or newer
- Obsidian 1.8.0 or newer
- A dedicated development vault

```bash
npm install
npm run check
npm run dev:vault
```

`npm run dev:vault` builds the plugin and installs `main.js`,
`manifest.json`, and `styles.css` into the ignored `dev-vault` directory.
Open that directory as an Obsidian vault and enable **Miller Tasks** under
Community plugins.

Use a different development vault by setting `MILLER_TASKS_VAULT`:

```bash
MILLER_TASKS_VAULT=/absolute/path/to/vault npm run dev:vault
```

## Project documents

- [`PLAN.md`](PLAN.md) tracks implementation checkpoints and acceptance.
- [`PROJECT_MEMORY.md`](PROJECT_MEMORY.md) is the living engineering memory:
  architecture, invariants, decisions, commands, current state, and next work.

## License

Miller Tasks is licensed under the GNU General Public License v3.0 only.
