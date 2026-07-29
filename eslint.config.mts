import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig(
  globalIgnores([
    "node_modules",
    "coverage",
    "dev-vault",
    "main.js",
    "package-lock.json",
    "versions.json",
  ]),
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.mts",
            "esbuild.config.mjs",
            "scripts/setup-dev-vault.mjs",
            "version-bump.mjs",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: [
      "*.mjs",
      "*.config.ts",
      "scripts/**/*.mjs",
    ],
    rules: {
      // Build, test, and installation scripts run in Node and are never
      // included in the mobile plugin bundle.
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      // This standalone setup script runs before an Obsidian Vault exists.
      "obsidianmd/hardcoded-config-path": "off",
      "obsidianmd/rule-custom-message": "off",
    },
  },
);
