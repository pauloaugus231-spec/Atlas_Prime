import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

export type ReadableRootKey =
  | "workspace"
  | "authorized_projects"
  | "authorized_dev"
  | "authorized_social"
  | "authorized_content"
  | "authorized_finance"
  | "authorized_admin";

export class FileAccessPolicy {
  private readonly readableRoots: string[];
  private readonly readableRootsByKey: Record<ReadableRootKey, string>;

  constructor(
    private readonly workspaceDir: string,
    private readonly authorizedProjectsDir: string,
  ) {
    const authorizedRoot = path.resolve(authorizedProjectsDir);
    this.readableRootsByKey = {
      workspace: path.resolve(workspaceDir),
      authorized_projects: authorizedRoot,
      authorized_dev: path.join(authorizedRoot, "Dev"),
      authorized_social: path.join(authorizedRoot, "Social"),
      authorized_content: path.join(authorizedRoot, "Conteudo"),
      authorized_finance: path.join(authorizedRoot, "Financeiro"),
      authorized_admin: path.join(authorizedRoot, "Admin"),
    };
    this.readableRoots = Object.values(this.readableRootsByKey);
  }

  listReadableRoots(): string[] {
    return [...this.readableRoots];
  }

  describeReadableRoots(): Record<ReadableRootKey, string> {
    return { ...this.readableRootsByKey };
  }

  resolveWorkspacePath(targetPath: string): string {
    const resolved = path.resolve(this.workspaceDir, targetPath);
    this.assertWithinRoot(resolved, this.workspaceDir, "write");
    return resolved;
  }

  resolveReadablePathFromRoot(rootKey: ReadableRootKey, targetPath = "."): string {
    const root = this.readableRootsByKey[rootKey];
    const resolved = this.resolveReadablePathWithAliases(root, targetPath);
    this.assertWithinRoot(resolved, root, "read");
    return resolved;
  }

  resolveReadablePath(targetPath: string): string {
    const resolved = path.resolve(targetPath);

    for (const root of this.readableRoots) {
      if (this.isWithinRoot(resolved, root)) {
        return resolved;
      }
    }

    throw new Error(
      `Path not allowed for reading: ${resolved}. Allowed roots: ${this.readableRoots.join(", ")}`,
    );
  }

  assertReadablePath(targetPath: string): void {
    this.resolveReadablePath(targetPath);
  }

  assertWritablePath(targetPath: string): void {
    const resolved = path.resolve(targetPath);
    this.assertWithinRoot(resolved, this.workspaceDir, "write");
  }

  private assertWithinRoot(targetPath: string, root: string, mode: "read" | "write"): void {
    if (!this.isWithinRoot(targetPath, root)) {
      throw new Error(`Path not allowed for ${mode}: ${targetPath}. Allowed root: ${root}`);
    }
  }

  private isWithinRoot(targetPath: string, root: string): boolean {
    const relative = path.relative(path.resolve(root), path.resolve(targetPath));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  private resolveReadablePathWithAliases(root: string, targetPath: string): string {
    const direct = path.resolve(root, targetPath);
    if (targetPath === "." || targetPath.trim() === "" || existsSync(direct)) {
      return direct;
    }

    const segments = targetPath
      .split(/[\\/]+/)
      .map((segment) => segment.trim())
      .filter(Boolean);

    if (segments.length === 0) {
      return direct;
    }

    const entries = readdirSync(root, { withFileTypes: true }).map((entry) => entry.name);
    const normalizedEntries = new Map(entries.map((entry) => [normalizeAliasToken(entry), entry]));

    for (let prefixLength = Math.min(segments.length, 3); prefixLength >= 1; prefixLength -= 1) {
      const prefix = segments.slice(0, prefixLength).join("_");
      const normalizedPrefix = normalizeAliasToken(prefix);
      const matchedEntry = normalizedEntries.get(normalizedPrefix);
      if (!matchedEntry) {
        continue;
      }

      const resolved = path.resolve(root, matchedEntry, ...segments.slice(prefixLength));
      if (existsSync(resolved)) {
        return resolved;
      }
    }

    return direct;
  }
}

function normalizeAliasToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s._/-]+/g, "");
}
