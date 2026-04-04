import { defineToolPlugin } from "../types/plugin.js";

interface GoogleWorkspaceStatusParameters {
  account?: string;
}

export default defineToolPlugin<GoogleWorkspaceStatusParameters>({
  name: "google_workspace_status",
  description:
    "Checks whether Google Workspace secretary integrations for calendar, tasks and contacts are configured and authenticated.",
  parameters: {
    type: "object",
    properties: {
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.googleWorkspaces.resolveAlias(parameters.account);
    const workspace = context.googleWorkspaces.getWorkspace(account);
    return {
      ok: true,
      account,
      accounts: context.googleWorkspaces.getAliases(),
      status: workspace.getStatus(),
    };
  },
});
