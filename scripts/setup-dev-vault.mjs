import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const vaultRoot = path.resolve(
  projectRoot,
  process.env.MILLER_TASKS_VAULT ?? "dev-vault",
);
const obsidianDirectory = path.join(vaultRoot, ".obsidian");
const pluginDirectory = path.join(
  obsidianDirectory,
  "plugins",
  "miller-tasks",
);

await mkdir(pluginDirectory, { recursive: true });

for (const fileName of ["main.js", "manifest.json", "styles.css"]) {
  await cp(
    path.join(projectRoot, fileName),
    path.join(pluginDirectory, fileName),
  );
}

const communityPluginsPath = path.join(
  obsidianDirectory,
  "community-plugins.json",
);
let enabledPlugins = [];

try {
  enabledPlugins = JSON.parse(
    await readFile(communityPluginsPath, "utf8"),
  );
} catch {
  // A new development vault does not have plugin settings yet.
}

if (!enabledPlugins.includes("miller-tasks")) {
  enabledPlugins.push("miller-tasks");
}

await writeFile(
  communityPluginsPath,
  `${JSON.stringify(enabledPlugins, null, 2)}\n`,
);

process.stdout.write(`Development vault ready: ${vaultRoot}\n`);
