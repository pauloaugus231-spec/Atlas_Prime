import { open, stat } from "node:fs/promises";
import path from "node:path";
import type { ReadableRootKey } from "../core/file-access-policy.js";
import { defineToolPlugin } from "../types/plugin.js";

const MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_CHARS = 12000;
const MAX_RETURN_CHARS = 40000;

interface ReadTextFileParameters {
  root?: ReadableRootKey;
  path: string;
  max_chars?: number;
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

function normalizeMaxChars(value?: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_CHARS;
  }

  const normalized = Math.floor(value as number);
  if (normalized < 200) {
    return 200;
  }
  if (normalized > MAX_RETURN_CHARS) {
    return MAX_RETURN_CHARS;
  }
  return normalized;
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

export default defineToolPlugin<ReadTextFileParameters>({
  name: "read_text_file",
  description: "Reads a text file from an approved root with size and output limits.",
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
        description: "Readable root where the file lives.",
        default: "authorized_projects",
      },
      path: {
        type: "string",
        description: "Relative path to the file inside the selected root.",
      },
      max_chars: {
        type: "integer",
        description: "Maximum number of characters to return from the file content.",
        default: DEFAULT_MAX_CHARS,
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const root = normalizeRoot(parameters.root);
    const relativePath = parameters.path.trim();
    const maxChars = normalizeMaxChars(parameters.max_chars);
    const resolvedPath = context.fileAccess.resolveReadablePathFromRoot(root, relativePath);
    const fileStats = await stat(resolvedPath);

    if (!fileStats.isFile()) {
      throw new Error(`Path is not a file: ${resolvedPath}`);
    }

    const bytesToRead = Math.min(fileStats.size, MAX_BYTES);
    const handle = await open(resolvedPath, "r");

    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      const contentBuffer = buffer.subarray(0, bytesRead);

      if (looksBinary(contentBuffer)) {
        throw new Error(`File does not look like UTF-8 text: ${resolvedPath}`);
      }

      const decoded = contentBuffer.toString("utf8");
      const content =
        decoded.length > maxChars ? `${decoded.slice(0, maxChars)}\n\n[truncated]` : decoded;

      return {
        root,
        path: relativePath,
        absolute_path: resolvedPath,
        file_name: path.basename(resolvedPath),
        size_bytes: fileStats.size,
        read_bytes: bytesRead,
        truncated_by_size: fileStats.size > MAX_BYTES,
        truncated_by_chars: decoded.length > maxChars,
        max_chars: maxChars,
        content,
      };
    } finally {
      await handle.close();
    }
  },
});
