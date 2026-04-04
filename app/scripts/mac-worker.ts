import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/load-config.js";
import { SupabaseMacCommandQueue } from "../src/integrations/supabase/mac-command-queue.js";
import { createLogger } from "../src/utils/logger.js";

function isCommandAllowed(argv: string[], allowedPrefixes: string[][]): boolean {
  return allowedPrefixes.some((prefix) =>
    prefix.length <= argv.length && prefix.every((token, index) => argv[index] === token),
  );
}

function isCwdAllowed(cwd: string | undefined, allowedRoots: string[]): boolean {
  if (!cwd) {
    return true;
  }
  const resolved = path.resolve(cwd);
  return allowedRoots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

function isPathWithinAllowedRoots(targetPath: string, allowedRoots: string[]): boolean {
  const resolved = path.resolve(targetPath);
  return allowedRoots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`);
  });
}

function validateCommandArguments(argv: string[], allowedRoots: string[]): string | null {
  if (argv.length === 0) {
    return "comando vazio";
  }

  if (argv[0] === "osascript") {
    const script = argv.slice(2).join(" ").trim();
    if (!/^display notification\s+/i.test(script)) {
      return "AppleScript fora da allowlist";
    }
    return null;
  }

  if (argv[0] === "open") {
    if (argv[1] === "-a" || argv[1] === "-g") {
      return null;
    }
    const target = argv[1];
    if (!target) {
      return "open sem alvo";
    }
    if (/^https?:\/\//i.test(target)) {
      return null;
    }
    if (!isPathWithinAllowedRoots(target, allowedRoots)) {
      return `path fora da allowlist: ${target}`;
    }
    return null;
  }

  if (argv[0] === "code") {
    const target = argv.filter((item) => !item.startsWith("-")).slice(1).pop();
    if (!target) {
      return null;
    }
    if (!isPathWithinAllowedRoots(target, allowedRoots)) {
      return `path fora da allowlist: ${target}`;
    }
    return null;
  }

  return null;
}

function executeArgv(argv: string[], cwd: string | undefined, timeoutMs: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        code: 124,
        output: `${output}\n[mac-worker] timeout after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        code: code ?? 0,
        output: output.trim(),
      });
    });
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.runtime.logLevel).child({ scope: "mac-worker" });
  const queue = new SupabaseMacCommandQueue(config.supabaseMacQueue, logger.child({ scope: "supabase-mac-queue" }));
  const status = queue.getStatus();
  if (!status.ready) {
    throw new Error(status.message);
  }

  const workerId = process.env.MAC_WORKER_ID?.trim() || `${status.targetHost}-${os.hostname()}`;
  const runOnce = ["1", "true", "yes"].includes((process.env.MAC_WORKER_ONCE ?? "").trim().toLowerCase());
  const timeoutMs = config.supabaseMacQueue.maxExecutionSeconds * 1000;

  logger.info("Mac worker ready", {
    workerId,
    targetHost: status.targetHost,
    pollIntervalSeconds: config.supabaseMacQueue.pollIntervalSeconds,
  });

  while (true) {
    await queue.heartbeat(workerId);
    const command = await queue.claimNext(workerId);
    if (!command) {
      if (runOnce) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, config.supabaseMacQueue.pollIntervalSeconds * 1000));
      continue;
    }

    if (!isCommandAllowed(command.argv, config.supabaseMacQueue.allowedCommands)) {
      await queue.markFailed(command.id, `[blocked] comando não permitido: ${command.argv.join(" ")}`);
      continue;
    }
    if (!isCwdAllowed(command.cwd, config.supabaseMacQueue.allowedCwds)) {
      await queue.markFailed(command.id, `[blocked] cwd não permitido: ${command.cwd ?? "(sem cwd)"}`);
      continue;
    }
    const argumentValidation = validateCommandArguments(command.argv, config.supabaseMacQueue.allowedCwds);
    if (argumentValidation) {
      await queue.markFailed(command.id, `[blocked] ${argumentValidation}`);
      continue;
    }

    logger.info("Executing Mac command", {
      id: command.id,
      summary: command.summary,
      argv: command.argv,
      cwd: command.cwd,
    });

    const result = await executeArgv(command.argv, command.cwd, timeoutMs);
    if (result.code === 0) {
      await queue.markCompleted(command.id, result.output || "[ok] comando executado sem saída textual");
    } else {
      await queue.markFailed(command.id, result.output || `[erro] exit code ${result.code}`);
    }

    if (runOnce) {
      return;
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
