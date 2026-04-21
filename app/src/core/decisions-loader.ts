import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../types/logger.js";
import { FileAccessPolicy } from "./file-access-policy.js";

interface DecisionEntry {
  heading: string;
  body: string;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseDecisionEntries(markdown: string): DecisionEntry[] {
  const lines = markdown.split(/\r?\n/);
  const entries: DecisionEntry[] = [];
  let currentHeading: string | undefined;
  let currentBody: string[] = [];

  const flush = (): void => {
    if (!currentHeading) {
      return;
    }

    entries.push({
      heading: currentHeading,
      body: normalizeWhitespace(currentBody.join(" ")),
    });
  };

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+?)\s*$/);
    if (headingMatch) {
      flush();
      currentHeading = headingMatch[1].trim();
      currentBody = [];
      continue;
    }

    if (currentHeading) {
      currentBody.push(line.trim());
    }
  }

  flush();
  return entries;
}

export class DecisionsLoader {
  constructor(
    private readonly fileAccess: FileAccessPolicy,
    private readonly logger: Logger,
    private readonly decisionsPath?: string,
  ) {}

  async load(): Promise<string | undefined> {
    const resolvedPath = this.resolveReadableDecisionsPath();
    if (!resolvedPath) {
      return undefined;
    }

    try {
      const content = await readFile(resolvedPath, "utf8");
      return content.trim() || undefined;
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return undefined;
      }

      this.logger.warn("Unable to read decisions file", {
        path: resolvedPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  loadSync(): string | undefined {
    const resolvedPath = this.resolveReadableDecisionsPath();
    if (!resolvedPath) {
      return undefined;
    }

    try {
      const content = readFileSync(resolvedPath, "utf8");
      return content.trim() || undefined;
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return undefined;
      }

      this.logger.warn("Unable to read decisions file synchronously", {
        path: resolvedPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  async summarize(): Promise<string | undefined> {
    const content = await this.load();
    if (!content) {
      return undefined;
    }

    const entries = parseDecisionEntries(content);
    if (entries.length === 0) {
      return undefined;
    }

    return entries
      .slice(-5)
      .map((entry, index) => `(${index + 1}) ${entry.heading} — ${entry.body}`)
      .join(" | ");
  }

  summarizeSync(): string | undefined {
    const content = this.loadSync();
    if (!content) {
      return undefined;
    }

    const entries = parseDecisionEntries(content);
    if (entries.length === 0) {
      return undefined;
    }

    return entries
      .slice(-5)
      .map((entry, index) => `(${index + 1}) ${entry.heading} — ${entry.body}`)
      .join(" | ");
  }

  private resolveReadableDecisionsPath(): string | undefined {
    const candidates = [
      this.decisionsPath ? path.resolve(this.decisionsPath) : undefined,
      path.resolve(this.fileAccess.resolveReadablePathFromRoot("workspace"), "DECISIONS.md"),
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      if (!existsSync(candidate)) {
        continue;
      }

      try {
        return this.fileAccess.resolveReadablePath(candidate);
      } catch {
        if (this.decisionsPath && path.resolve(candidate) === path.resolve(this.decisionsPath)) {
          this.logger.debug("Reading decisions file from explicit path outside default readable roots", {
            path: candidate,
          });
          return candidate;
        }
      }
    }

    return undefined;
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "ENOENT";
}
