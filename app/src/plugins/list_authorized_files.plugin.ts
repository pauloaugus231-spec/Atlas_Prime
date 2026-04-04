import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { ReadableRootKey } from "../core/file-access-policy.js";
import { defineToolPlugin } from "../types/plugin.js";

const MAX_ENTRIES = 200;
const MAX_DEPTH = 5;

type EntryType = "file" | "directory";

interface ListAuthorizedFilesParameters {
  root?: ReadableRootKey;
  path?: string;
  max_depth?: number;
  include_hidden?: boolean;
  directories_only?: boolean;
}

interface ListedEntry {
  name: string;
  relative_path: string;
  type: EntryType;
  size_bytes?: number;
}

function normalizeRoot(root?: ReadableRootKey): ReadableRootKey {
  const allowed: ReadableRootKey[] = [
    "workspace",
    "authorized_projects",
    "authorized_dev",
    "authorized_social",
    "authorized_content",
    "authorized_finance",
    "authorized_admin",
  ];
  return allowed.includes(root as ReadableRootKey) ? (root as ReadableRootKey) : "authorized_projects";
}

function normalizeDepth(value?: number): number {
  if (!Number.isFinite(value)) {
    return 2;
  }

  const normalized = Math.floor(value as number);
  if (normalized < 0) {
    return 0;
  }
  if (normalized > MAX_DEPTH) {
    return MAX_DEPTH;
  }
  return normalized;
}

function isHidden(name: string): boolean {
  return name.startsWith(".");
}

export default defineToolPlugin<ListAuthorizedFilesParameters>({
  name: "list_authorized_files",
  description: "Lists files and directories inside approved roots only.",
  parameters: {
    type: "object",
    properties: {
      root: {
        type: "string",
        enum: [
          "authorized_projects",
          "workspace",
          "authorized_dev",
          "authorized_social",
          "authorized_content",
          "authorized_finance",
          "authorized_admin",
        ],
        description: "Readable root to inspect.",
        default: "authorized_projects",
      },
      path: {
        type: "string",
        description: "Relative path inside the selected root.",
        default: ".",
      },
      max_depth: {
        type: "integer",
        description: "Recursion depth limit between 0 and 5.",
        default: 2,
      },
      include_hidden: {
        type: "boolean",
        description: "Whether hidden files and directories should be included.",
        default: false,
      },
      directories_only: {
        type: "boolean",
        description: "Whether only directories should be returned.",
        default: false,
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const root = normalizeRoot(parameters.root);
    const relativeTarget = parameters.path?.trim() || ".";
    const maxDepth = normalizeDepth(parameters.max_depth);
    const includeHidden = parameters.include_hidden ?? false;
    const directoriesOnly = parameters.directories_only ?? false;
    const roots = context.fileAccess.describeReadableRoots();
    const rootAbsolutePath = roots[root];
    const targetPath = context.fileAccess.resolveReadablePathFromRoot(root, relativeTarget);
    const targetStats = await stat(targetPath);

    if (!targetStats.isDirectory()) {
      const relativePath = path.relative(rootAbsolutePath, targetPath) || path.basename(targetPath);
      return {
        root,
        target_path: relativeTarget,
        resolved_path: targetPath,
        total_entries: 1,
        truncated: false,
        entries: [
          {
            name: path.basename(targetPath),
            relative_path: relativePath,
            type: "file",
            size_bytes: targetStats.size,
          },
        ],
      };
    }

    const entries: ListedEntry[] = [];
    let truncated = false;

    const walk = async (currentPath: string, depth: number): Promise<void> => {
      if (truncated) {
        return;
      }

      const dirEntries = await readdir(currentPath, { withFileTypes: true });
      dirEntries.sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of dirEntries) {
        if (truncated) {
          return;
        }
        if (!includeHidden && isHidden(entry.name)) {
          continue;
        }

        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(rootAbsolutePath, fullPath) || entry.name;

        if (entry.isDirectory()) {
          entries.push({
            name: entry.name,
            relative_path: relativePath,
            type: "directory",
          });

          if (entries.length >= MAX_ENTRIES) {
            truncated = true;
            return;
          }

          if (depth < maxDepth) {
            await walk(fullPath, depth + 1);
          }
          continue;
        }

        if (directoriesOnly) {
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const fileStats = await stat(fullPath);
        entries.push({
          name: entry.name,
          relative_path: relativePath,
          type: "file",
          size_bytes: fileStats.size,
        });

        if (entries.length >= MAX_ENTRIES) {
          truncated = true;
          return;
        }
      }
    };

    await walk(targetPath, 0);

    return {
      root,
      target_path: relativeTarget,
      resolved_path: targetPath,
      max_depth: maxDepth,
      include_hidden: includeHidden,
      directories_only: directoriesOnly,
      total_entries: entries.length,
      truncated,
      entries,
    };
  },
});
