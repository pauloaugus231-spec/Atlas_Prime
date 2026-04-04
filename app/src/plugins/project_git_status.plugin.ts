import { defineToolPlugin } from "../types/plugin.js";

interface ProjectGitStatusParameters {
  root: "workspace" | "authorized_projects" | "authorized_dev";
  path?: string;
}

export default defineToolPlugin<ProjectGitStatusParameters>({
  name: "project_git_status",
  description:
    "Returns a safe git branch and status summary for a project inside workspace or authorized dev roots.",
  parameters: {
    type: "object",
    properties: {
      root: {
        type: "string",
        enum: ["workspace", "authorized_projects", "authorized_dev"],
        description: "Authorized root where the git repository lives.",
      },
      path: {
        type: "string",
        description: "Relative path inside the root.",
        default: ".",
      },
    },
    required: ["root"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    if (!context.orchestration.policy.capabilities.canRunProjectTools) {
      throw new Error("Git status tools are restricted by the current domain policy.");
    }

    const result = await context.projectOps.getGitStatus(parameters.root, parameters.path ?? ".");
    return {
      ok: true,
      ...result,
    };
  },
});
