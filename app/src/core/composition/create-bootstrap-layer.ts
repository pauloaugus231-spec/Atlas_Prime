import { loadConfig } from "../../config/load-config.js";
import type { Logger } from "../../types/logger.js";
import { createLogger } from "../../utils/logger.js";
import { FileAccessPolicy } from "../file-access-policy.js";
import { ProjectOpsService } from "../project-ops.js";
import { SafeExecService } from "../safe-exec.js";
import type { BootstrapLayer } from "./types.js";

export function createBootstrapLayer(): BootstrapLayer {
  const config = loadConfig();
  const logger = createLogger(config.runtime.logLevel);
  const pluginLogger = logger.child({ scope: "plugins" }) as Logger;
  const fileAccess = new FileAccessPolicy(
    config.paths.workspaceDir,
    config.paths.authorizedProjectsDir,
  );
  const projectOps = new ProjectOpsService(
    fileAccess,
    logger.child({ scope: "project-ops" }),
  );
  const safeExec = new SafeExecService(
    config.safeExec,
    fileAccess,
    logger.child({ scope: "safe-exec" }),
  );

  return {
    config,
    logger,
    pluginLogger,
    fileAccess,
    projectOps,
    safeExec,
  };
}
