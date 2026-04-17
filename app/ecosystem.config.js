const path = require("node:path");

const projectRoot = path.resolve(__dirname);
const logsDir = process.env.HOST_AGENT_LOGS || process.env.LOGS_DIR || path.join(projectRoot, "logs");

module.exports = {
  apps: [
    {
      name: "atlas-mac-worker",
      cwd: projectRoot,
      script: "npm",
      args: "run mac:worker",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "development",
      },
      out_file: path.join(logsDir, "atlas-mac-worker.out.log"),
      error_file: path.join(logsDir, "atlas-mac-worker.err.log"),
    },
    {
      name: "atlas-whatsapp-sidecar",
      cwd: projectRoot,
      script: "npm",
      args: "run whatsapp:sidecar",
      interpreter: "none",
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "development",
      },
      out_file: path.join(logsDir, "atlas-whatsapp-sidecar.out.log"),
      error_file: path.join(logsDir, "atlas-whatsapp-sidecar.err.log"),
    },
  ],
};
