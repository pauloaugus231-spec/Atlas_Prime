import { appendFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import type { SafeExecConfig } from "../types/config.js";
import type { Logger } from "../types/logger.js";
import type { FileAccessPolicy, ReadableRootKey } from "./file-access-policy.js";

export interface SafeExecRequest {
  root: ReadableRootKey;
  path?: string;
  argv: string[];
}

export interface SafeExecResult {
  cwd: string;
  argv: string[];
  allowed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
}

function startsWithCommand(argv: string[], allowed: string[]): boolean {
  if (argv.length < allowed.length) {
    return false;
  }
  return allowed.every((part, index) => argv[index] === part);
}

function commandRequiresWritableRoot(argv: string[]): boolean {
  const executable = argv[0];
  return executable === "npm" || executable === "pnpm" || executable === "yarn";
}

export class SafeExecService {
  constructor(
    private readonly config: SafeExecConfig,
    private readonly fileAccess: FileAccessPolicy,
    private readonly logger: Logger,
  ) {}

  getStatus(): Record<string, unknown> {
    return {
      enabled: this.config.enabled,
      allowedCommands: this.config.allowedCommands,
      maxOutputChars: this.config.maxOutputChars,
      auditLogPath: this.config.auditLogPath,
    };
  }

  async execute(request: SafeExecRequest): Promise<SafeExecResult> {
    if (!this.config.enabled) {
      throw new Error("safe_exec is disabled by configuration.");
    }
    if (!request.argv.length) {
      throw new Error("Command argv cannot be empty.");
    }

    const cwd = this.fileAccess.resolveReadablePathFromRoot(request.root, request.path ?? ".");
    const allowed = this.config.allowedCommands.some((allowedCommand) => startsWithCommand(request.argv, allowedCommand));

    if (!allowed) {
      await this.audit({
        cwd,
        argv: request.argv,
        allowed: false,
        exitCode: -1,
        stdout: "",
        stderr: "blocked-by-allowlist",
      });
      throw new Error(`Command not allowed: ${request.argv.join(" ")}`);
    }

    if (commandRequiresWritableRoot(request.argv) && request.root !== "workspace") {
      const blocked: SafeExecResult = {
        cwd,
        argv: request.argv,
        allowed: false,
        exitCode: -1,
        stdout: "",
        stderr:
          "blocked-by-root-policy: writable package-manager commands are only allowed inside the workspace root",
      };
      await this.audit(blocked);
      throw new Error(
        `Command requires writable workspace: ${request.argv.join(" ")}. Copy or mirror the project into /workspace first.`,
      );
    }

    const result = await new Promise<SafeExecResult>((resolve, reject) => {
      const child = spawn(request.argv[0], request.argv.slice(1), {
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
      child.on("error", async (error) => {
        const failure: SafeExecResult = {
          cwd,
          argv: request.argv,
          allowed: true,
          exitCode: -1,
          stdout: stdout.slice(0, this.config.maxOutputChars),
          stderr: String(error).slice(0, this.config.maxOutputChars),
        };
        await this.audit(failure);
        reject(error);
      });
      child.on("close", (code) => {
        resolve({
          cwd,
          argv: request.argv,
          allowed: true,
          exitCode: code ?? -1,
          stdout: stdout.slice(0, this.config.maxOutputChars),
          stderr: stderr.slice(0, this.config.maxOutputChars),
        });
      });
    });

    await this.audit(result);
    this.logger.info("safe_exec completed", {
      cwd: result.cwd,
      argv: result.argv,
      exitCode: result.exitCode,
    });
    return result;
  }

  private async audit(result: SafeExecResult): Promise<void> {
    await mkdir(path.dirname(this.config.auditLogPath), { recursive: true });
    await appendFile(
      this.config.auditLogPath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        cwd: result.cwd,
        argv: result.argv,
        allowed: result.allowed,
        exitCode: result.exitCode,
        stdoutPreview: result.stdout.slice(0, 500),
        stderrPreview: result.stderr.slice(0, 500),
      }) + "\n",
      "utf8",
    );
  }
}
