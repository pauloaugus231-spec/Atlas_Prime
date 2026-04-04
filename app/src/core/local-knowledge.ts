import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../types/logger.js";
import type { FileAccessPolicy, ReadableRootKey } from "./file-access-policy.js";
import type { ResolvedKnowledgeAlias } from "./knowledge-aliases.js";

export interface LocalKnowledgeMatch {
  root: ReadableRootKey;
  rootLabel: string;
  relativePath: string;
  absolutePath: string;
  snippet: string;
  score: number;
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".svelte",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
  ".sql",
  ".csv",
  ".html",
  ".htm",
]);

const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".svelte-kit",
  ".next",
  ".wrangler",
  "coverage",
  ".turbo",
  "upstream",
]);

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function toRootLabel(root: ReadableRootKey): string {
  return root.replace(/^authorized_/, "");
}

function buildSearchTerms(query: string, alias?: ResolvedKnowledgeAlias): string[] {
  const terms = new Set<string>();
  const normalizedQuery = normalize(query)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (normalizedQuery.length >= 3) {
    terms.add(normalizedQuery);
  }

  for (const part of normalizedQuery.split(" ")) {
    const trimmed = part.trim();
    if (trimmed.length >= 3 && !["qual", "quais", "onde", "fica", "sobre", "internet", "procure", "busque", "buscar", "pesquise", "porto", "alegre"].includes(trimmed)) {
      terms.add(trimmed);
    }
  }

  for (const term of alias?.terms ?? []) {
    const normalizedTerm = normalize(term).trim();
    if (normalizedTerm.length >= 3) {
      terms.add(normalizedTerm);
    }
  }

  return [...terms];
}

function extractSnippet(content: string, terms: string[]): string | undefined {
  const normalizedContent = normalize(content);

  let bestIndex = -1;
  for (const term of terms) {
    const index = normalizedContent.indexOf(term);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  if (bestIndex === -1) {
    return undefined;
  }

  const start = Math.max(0, bestIndex - 120);
  const end = Math.min(content.length, bestIndex + 220);
  return content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMatch(relativePath: string, content: string, terms: string[], alias?: ResolvedKnowledgeAlias): number {
  const normalizedPath = normalize(relativePath);
  const normalizedContent = normalize(content);
  let score = 0;

  for (const term of terms) {
    if (normalizedContent.includes(term)) {
      score += term.length >= 10 ? 30 : 12;
    }
    if (normalizedPath.includes(term)) {
      score += 20;
    }
  }

  for (const matched of alias?.matchedTerms ?? []) {
    const normalizedMatched = normalize(matched);
    if (normalizedContent.includes(normalizedMatched)) {
      score += 40;
    }
    if (normalizedPath.includes(normalizedMatched)) {
      score += 25;
    }
  }

  return score;
}

interface WalkCandidate {
  root: ReadableRootKey;
  baseDir: string;
}

export class LocalKnowledgeService {
  constructor(
    private readonly fileAccess: FileAccessPolicy,
    private readonly logger: Logger,
  ) {}

  async search(input: {
    query: string;
    alias?: ResolvedKnowledgeAlias;
    maxResults?: number;
  }): Promise<LocalKnowledgeMatch[]> {
    const maxResults = Math.min(Math.max(input.maxResults ?? 5, 1), 10);
    const terms = buildSearchTerms(input.query, input.alias);
    if (terms.length === 0) {
      return [];
    }

    const candidates = this.resolveCandidates(input.alias);
    const matches: LocalKnowledgeMatch[] = [];

    for (const candidate of candidates) {
      const files = await this.collectFiles(candidate.baseDir, 120);
      for (const filePath of files) {
        try {
          const content = await readFile(filePath, "utf8");
          const snippet = extractSnippet(content, terms);
          if (!snippet) {
            continue;
          }

          const relativePath = path.relative(candidate.baseDir, filePath) || path.basename(filePath);
          const score = scoreMatch(relativePath, snippet, terms, input.alias);
          if (score <= 0) {
            continue;
          }

          matches.push({
            root: candidate.root,
            rootLabel: toRootLabel(candidate.root),
            relativePath,
            absolutePath: filePath,
            snippet,
            score,
          });
        } catch (error) {
          this.logger.warn("Failed to read local knowledge file", {
            filePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return matches
      .sort((left, right) => right.score - left.score)
      .filter((match, index, all) =>
        all.findIndex((item) => item.absolutePath === match.absolutePath && item.snippet === match.snippet) === index,
      )
      .slice(0, maxResults);
  }

  private resolveCandidates(alias?: ResolvedKnowledgeAlias): WalkCandidate[] {
    const candidates: WalkCandidate[] = [];
    const roots = alias?.localPaths?.length
      ? alias.localPaths
      : [
          { root: "authorized_dev" as ReadableRootKey, path: "." },
          { root: "authorized_social" as ReadableRootKey, path: "." },
          { root: "authorized_content" as ReadableRootKey, path: "." },
        ];

    for (const item of roots) {
      try {
        const baseDir = this.fileAccess.resolveReadablePathFromRoot(item.root, item.path);
        candidates.push({
          root: item.root,
          baseDir,
        });
      } catch {
        continue;
      }
    }

    return candidates;
  }

  private async collectFiles(baseDir: string, limit: number): Promise<string[]> {
    const results: string[] = [];
    const queue = [baseDir];
    const visited = new Set<string>();

    while (queue.length > 0 && results.length < limit) {
      const current = queue.shift()!;
      let realCurrent = current;
      try {
        realCurrent = await realpath(current);
      } catch {
        realCurrent = current;
      }

      if (visited.has(realCurrent)) {
        continue;
      }
      visited.add(realCurrent);

      let entries;
      try {
        entries = await readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (results.length >= limit) {
          break;
        }

        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) {
            queue.push(entryPath);
          }
          continue;
        }

        if (entry.isSymbolicLink()) {
          try {
            const linkStats = await stat(entryPath);
            if (linkStats.isDirectory()) {
              if (!IGNORED_DIRS.has(path.basename(entryPath))) {
                queue.push(entryPath);
              }
              continue;
            }
          } catch {
            continue;
          }
        }

        const extension = path.extname(entry.name).toLowerCase();
        if (!TEXT_EXTENSIONS.has(extension)) {
          continue;
        }

        try {
          const fileStats = await lstat(entryPath);
          if (fileStats.size > 300 * 1024) {
            continue;
          }
        } catch {
          continue;
        }

        results.push(entryPath);
      }
    }

    return results;
  }
}
