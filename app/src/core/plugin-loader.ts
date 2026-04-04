import { access, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Logger } from "../types/logger.js";
import type { LoadedToolPlugin, ToolPluginDefinition } from "../types/plugin.js";

const SUPPORTED_PLUGIN_FILE = /\.plugin\.(?:[cm]?js|[cm]?ts)$/i;

interface PluginRoot {
  dir: string;
  origin: "builtin" | "external";
}

function isToolPluginDefinition(candidate: unknown): candidate is ToolPluginDefinition {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }

  const plugin = candidate as Partial<ToolPluginDefinition>;
  return (
    plugin.kind === "tool" &&
    typeof plugin.name === "string" &&
    plugin.name.length > 0 &&
    typeof plugin.description === "string" &&
    typeof plugin.execute === "function" &&
    Boolean(plugin.parameters)
  );
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectPluginFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (entry.isFile() && SUPPORTED_PLUGIN_FILE.test(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function loadToolPlugins(
  roots: PluginRoot[],
  logger: Logger,
): Promise<LoadedToolPlugin[]> {
  const loaded = new Map<string, LoadedToolPlugin>();

  for (const root of roots) {
    if (!(await exists(root.dir))) {
      logger.debug("Plugin root does not exist, skipping", { root: root.dir, origin: root.origin });
      continue;
    }

    const files = await collectPluginFiles(root.dir);
    for (const filePath of files) {
      try {
        const moduleUrl = pathToFileURL(filePath).href;
        const imported = (await import(moduleUrl)) as { default?: unknown; plugin?: unknown };
        const candidate = imported.default ?? imported.plugin;

        if (!isToolPluginDefinition(candidate)) {
          logger.warn("Skipping invalid plugin module", { filePath });
          continue;
        }

        if (loaded.has(candidate.name)) {
          logger.warn("Skipping duplicate plugin name", {
            plugin: candidate.name,
            kept: loaded.get(candidate.name)?.sourcePath,
            skipped: filePath,
          });
          continue;
        }

        loaded.set(candidate.name, {
          plugin: candidate,
          sourcePath: filePath,
          origin: root.origin,
        });
      } catch (error) {
        logger.error("Failed to import plugin module", {
          filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return [...loaded.values()];
}
