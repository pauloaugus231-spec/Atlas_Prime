import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { ReadableRootKey } from "./file-access-policy.js";
import type { FileAccessPolicy } from "./file-access-policy.js";
import type { Logger } from "../types/logger.js";

const TEXT_FILE_LIMIT = 200_000;

interface ScanProjectInput {
  root: ReadableRootKey;
  path?: string;
}

function countExtensions(fileNames: string[]): Array<{ extension: string; count: number }> {
  const counts = new Map<string, number>();
  for (const fileName of fileNames) {
    const extension = path.extname(fileName).toLowerCase() || "[sem_extensao]";
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([extension, count]) => ({ extension, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
}

function detectProjectType(entries: string[]): string[] {
  const lower = new Set(entries.map((entry) => entry.toLowerCase()));
  const types: string[] = [];
  if (lower.has("package.json")) {
    types.push("nodejs");
  }
  if (lower.has("pyproject.toml") || lower.has("requirements.txt")) {
    types.push("python");
  }
  if (lower.has("dockerfile") || lower.has("docker-compose.yml") || lower.has("compose.yml")) {
    types.push("docker");
  }
  if (lower.has("tsconfig.json")) {
    types.push("typescript");
  }
  if (lower.has("next.config.js") || lower.has("next.config.mjs") || lower.has("next.config.ts")) {
    types.push("nextjs");
  }
  if (lower.has("vite.config.ts") || lower.has("vite.config.js")) {
    types.push("vite");
  }
  return types;
}

async function readJsonIfPresent(targetPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(targetPath, "utf8");
    if (raw.length > TEXT_FILE_LIMIT) {
      return null;
    }
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function runGitCommand(command: string[], cwd: string, logger: Logger): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      logger.warn("Safe project command failed", { command: command.join(" "), cwd, code, stderr: stderr.trim() });
      reject(new Error(stderr.trim() || `Command failed with exit code ${code}`));
    });
  });
}

export class ProjectOpsService {
  constructor(
    private readonly fileAccess: FileAccessPolicy,
    private readonly logger: Logger,
  ) {}

  async scanProject(input: ScanProjectInput): Promise<Record<string, unknown>> {
    const absolutePath = this.fileAccess.resolveReadablePathFromRoot(input.root, input.path ?? ".");
    const entries = await readdir(absolutePath, { withFileTypes: true });
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
    const directoryNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const packageJson = await readJsonIfPresent(path.join(absolutePath, "package.json"));
    const scripts = packageJson && typeof packageJson.scripts === "object" && packageJson.scripts
      ? Object.keys(packageJson.scripts as Record<string, unknown>).sort()
      : [];
    const dependencies = packageJson && typeof packageJson.dependencies === "object" && packageJson.dependencies
      ? Object.keys(packageJson.dependencies as Record<string, unknown>).slice(0, 20)
      : [];

    return {
      root: input.root,
      requested_path: input.path ?? ".",
      absolute_path: absolutePath,
      project_name:
        (packageJson && typeof packageJson.name === "string" && packageJson.name) || path.basename(absolutePath),
      project_types: detectProjectType([...fileNames, ...directoryNames]),
      root_files: fileNames.slice(0, 40),
      root_directories: directoryNames.slice(0, 40),
      top_extensions: countExtensions(fileNames),
      package_json_present: Boolean(packageJson),
      package_manager_files: fileNames.filter((name) => ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb"].includes(name)),
      scripts,
      dependencies,
      has_readme: fileNames.some((name) => /^readme/i.test(name)),
      has_docker: fileNames.some((name) => /docker/i.test(name)),
      has_env_example: fileNames.some((name) => /^\.env(\.example|\.sample)?$/i.test(name)),
      pyproject_present: fileNames.includes("pyproject.toml"),
    };
  }

  async getGitStatus(root: ReadableRootKey, relativePath = "."): Promise<Record<string, unknown>> {
    const absolutePath = this.fileAccess.resolveReadablePathFromRoot(root, relativePath);
    const branch = await runGitCommand(["git", "branch", "--show-current"], absolutePath, this.logger);
    const status = await runGitCommand(["git", "status", "--short"], absolutePath, this.logger);
    const diffStat = await runGitCommand(["git", "diff", "--stat"], absolutePath, this.logger).catch(() => "");

    return {
      root,
      requested_path: relativePath,
      absolute_path: absolutePath,
      branch,
      dirty: Boolean(status.trim()),
      status_lines: status ? status.split("\n").filter(Boolean).slice(0, 50) : [],
      diff_stat: diffStat ? diffStat.split("\n").filter(Boolean).slice(0, 20) : [],
    };
  }
}
