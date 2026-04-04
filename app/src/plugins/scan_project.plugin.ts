import { defineToolPlugin } from "../types/plugin.js";

interface ScanProjectParameters {
  root:
    | "workspace"
    | "authorized_projects"
    | "authorized_dev"
    | "authorized_social"
    | "authorized_content"
    | "authorized_finance"
    | "authorized_admin";
  path?: string;
}

export default defineToolPlugin<ScanProjectParameters>({
  name: "scan_project",
  description:
    "Scans a project or directory inside an authorized root and returns a compact operational summary for dev work.",
  parameters: {
    type: "object",
    properties: {
      root: {
        type: "string",
        enum: [
          "workspace",
          "authorized_projects",
          "authorized_dev",
          "authorized_social",
          "authorized_content",
          "authorized_finance",
          "authorized_admin",
        ],
        description: "Authorized root to scan.",
      },
      path: {
        type: "string",
        description: "Relative path inside the selected root.",
        default: ".",
      },
    },
    required: ["root"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    if (!context.orchestration.policy.capabilities.canRunProjectTools) {
      throw new Error("Project analysis tools are restricted by the current domain policy.");
    }

    const result = await context.projectOps.scanProject({
      root: parameters.root,
      path: parameters.path,
    });

    return {
      ok: true,
      ...result,
    };
  },
});
