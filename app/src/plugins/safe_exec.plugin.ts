import { defineToolPlugin } from "../types/plugin.js";

interface SafeExecParameters {
  root:
    | "workspace"
    | "authorized_projects"
    | "authorized_dev";
  path?: string;
  argv: string[];
}

export default defineToolPlugin<SafeExecParameters>({
  name: "safe_exec",
  description:
    "Executes a strictly allowlisted non-interactive command inside workspace or authorized dev roots and records an audit log.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      root: {
        type: "string",
        enum: ["workspace", "authorized_projects", "authorized_dev"],
      },
      path: {
        type: "string",
        description: "Relative path inside the selected root.",
        default: ".",
      },
      argv: {
        type: "array",
        items: {
          type: "string",
        },
        minItems: 1,
        description: "Command and arguments as a tokenized argv array.",
      },
    },
    required: ["root", "argv"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    if (!context.orchestration.policy.capabilities.canRunProjectTools) {
      throw new Error("safe_exec is blocked by the current domain policy.");
    }

    const result = await context.safeExec.execute({
      root: parameters.root,
      path: parameters.path,
      argv: parameters.argv,
    });

    return {
      ok: true,
      ...result,
    };
  },
});
