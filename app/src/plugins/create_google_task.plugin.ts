import { defineToolPlugin } from "../types/plugin.js";

interface CreateGoogleTaskParameters {
  title: string;
  notes?: string;
  due?: string;
  task_list_id?: string;
  account?: string;
}

export default defineToolPlugin<CreateGoogleTaskParameters>({
  name: "create_google_task",
  description:
    "Creates a Google Task item only after explicit user confirmation. Hidden from the model by default.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Task title.",
      },
      notes: {
        type: "string",
        description: "Optional task notes.",
      },
      due: {
        type: "string",
        description: "Optional RFC3339 due timestamp.",
      },
      task_list_id: {
        type: "string",
        description: "Optional explicit Google Task list id.",
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
    },
    required: ["title"],
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

    const task = await workspace.createTask({
      title: parameters.title,
      notes: parameters.notes,
      due: parameters.due,
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
