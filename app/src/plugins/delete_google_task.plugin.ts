import { defineToolPlugin } from "../types/plugin.js";

interface DeleteGoogleTaskParameters {
  task_id: string;
  task_list_id: string;
  account?: string;
}

export default defineToolPlugin<DeleteGoogleTaskParameters>({
  name: "delete_google_task",
  description: "Deletes a Google Task item in a controlled flow.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      task_id: {
        type: "string",
        description: "Google Task id.",
      },
      task_list_id: {
        type: "string",
        description: "Google Task list id.",
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
    },
    required: ["task_id", "task_list_id"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.googleWorkspaces.resolveAlias(parameters.account);
    const workspace = context.googleWorkspaces.getWorkspace(account);
    const status = workspace.getStatus();
    if (!status.ready) {
      return {
        ok: false,
        account,
        status,
      };
    }

    const task = await workspace.deleteTask({
      taskId: parameters.task_id,
      taskListId: parameters.task_list_id,
    });

    return {
      ok: true,
      account,
      status: workspace.getStatus(),
      task,
    };
  },
});
