import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineToolPlugin } from "../types/plugin.js";

const MAX_CONTENT_CHARS = 120_000;

interface WriteWorkspaceFileParameters {
  path: string;
  content: string;
  overwrite?: boolean;
}

export default defineToolPlugin<WriteWorkspaceFileParameters>({
  name: "write_workspace_file",
  description:
    "Writes a UTF-8 text or markdown file inside the workspace only, with overwrite protection by default.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Relative path inside the workspace where the file should be written.",
      },
      content: {
        type: "string",
        description: "UTF-8 content to write.",
      },
      overwrite: {
        type: "boolean",
        description: "Whether an existing file can be replaced.",
        default: false,
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const relativePath = parameters.path.trim();
    const content = parameters.content;

    if (!relativePath) {
      throw new Error("Path cannot be empty");
    }
    if (content.length > MAX_CONTENT_CHARS) {
      throw new Error(`Content too large. Limit: ${MAX_CONTENT_CHARS} characters`);
    }

    const targetPath = context.fileAccess.resolveWorkspacePath(relativePath);
    const directory = path.dirname(targetPath);
    await mkdir(directory, { recursive: true });

    if (!parameters.overwrite) {
      try {
        await access(targetPath);
        throw new Error(`File already exists: ${targetPath}`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("File already exists")) {
          throw error;
        }
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
          // File does not exist yet, so the write is allowed.
        } else if (error) {
          throw error;
        }
      }
    }

    await writeFile(targetPath, content, "utf8");

    return {
      ok: true,
      path: relativePath,
      absolute_path: targetPath,
      chars_written: content.length,
      overwritten: parameters.overwrite ?? false,
    };
  },
});
