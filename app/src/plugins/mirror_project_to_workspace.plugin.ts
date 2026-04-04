import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ReadableRootKey } from "../core/file-access-policy.js";
import { defineToolPlugin } from "../types/plugin.js";

const EXCLUDED_NAMES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".cache",
  ".wrangler",
  "coverage",
  ".DS_Store",
]);

interface MirrorProjectParameters {
  root?: ReadableRootKey;
  path: string;
  target_path?: string;
  clean?: boolean;
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
  return allowed.includes(root as ReadableRootKey) ? (root as ReadableRootKey) : "authorized_dev";
}

function buildDefaultTarget(root: ReadableRootKey, relativePath: string): string {
  const parts = relativePath
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const baseName = parts.length > 0 ? parts[parts.length - 1] : "project";
  const safeBaseName = baseName.replace(/[^A-Za-z0-9._-]+/g, "_");
  return path.posix.join("mirrors", root, safeBaseName);
}

export default defineToolPlugin<MirrorProjectParameters>({
  name: "mirror_project_to_workspace",
  description:
    "Copies an approved project or directory into the writable workspace, excluding heavy/generated folders like .git, node_modules and dist.",
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
        default: "authorized_dev",
        description: "Readable root where the source project currently lives.",
      },
      path: {
        type: "string",
        description: "Relative path to the source project or directory inside the selected root.",
      },
      target_path: {
        type: "string",
        description: "Optional relative path inside the workspace where the mirror should be created.",
      },
      clean: {
        type: "boolean",
        description: "Whether an existing target directory should be removed before copying.",
        default: true,
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const root = normalizeRoot(parameters.root);
    const sourceRelativePath = parameters.path.trim();
    if (!sourceRelativePath) {
      throw new Error("Source path cannot be empty.");
    }

    const targetRelativePath = (parameters.target_path?.trim() || buildDefaultTarget(root, sourceRelativePath)).replace(/^\/+/, "");
    const sourcePath = context.fileAccess.resolveReadablePathFromRoot(root, sourceRelativePath);
    const targetPath = context.fileAccess.resolveWorkspacePath(targetRelativePath);

    if (parameters.clean ?? true) {
      await rm(targetPath, { recursive: true, force: true });
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: false,
      force: true,
      preserveTimestamps: false,
      dereference: true,
      filter: (item) => {
        const name = path.basename(item);
        return !EXCLUDED_NAMES.has(name);
      },
    });

    return {
      ok: true,
      root,
      source_path: sourceRelativePath,
      source_absolute_path: sourcePath,
      target_path: targetRelativePath,
      target_absolute_path: targetPath,
      clean: parameters.clean ?? true,
      excluded_names: [...EXCLUDED_NAMES],
    };
  },
});
