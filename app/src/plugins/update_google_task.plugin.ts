import { defineToolPlugin } from "../types/plugin.js";

interface UpdateGoogleTaskParameters {
  task_id: string;
  task_list_id: string;
  title?: string;
  notes?: string;
  due?: string | null;
  status?: string;
  account?: string;
}

function hasTaskUpdateFields(parameters: UpdateGoogleTaskParameters): boolean {
  return ["title", "notes", "due", "status"].some((field) =>
    Object.prototype.hasOwnProperty.call(parameters, field)
  );
}

export default defineToolPlugin<UpdateGoogleTaskParameters>({
  name: "update_google_task",
  description: "Updates a Google Task item in a controlled flow.",
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
      title: {
        type: "string",
        description: "Updated task title.",
      },
      notes: {
        type: "string",
        description: "Updated task notes.",
      },
      due: {
        type: ["string", "null"],
        description: "Updated RFC3339 due timestamp or null to clear it.",
      },
      status: {
        type: "string",
        description: "Updated Google Tasks status, for example needsAction or completed.",
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
        error: "Google workspace is not ready.",
      };
    }

    if (!status.writeReady) {
      return {
        ok: false,
        account,
        status,
        error: "Google workspace is authenticated but missing write scopes.",
      };
    }

    if (!hasTaskUpdateFields(parameters)) {
      return {
        ok: false,
        account,
        status,
        error: "Update operations require at least one field to change.",
      };
    }

    const task = await workspace.updateTask({
      taskId: parameters.task_id,
      taskListId: parameters.task_list_id,
      ...(typeof parameters.title === "string" ? { title: parameters.title } : {}),
      ...(typeof parameters.notes === "string" ? { notes: parameters.notes } : {}),
      ...(Object.prototype.hasOwnProperty.call(parameters, "due") ? { due: parameters.due ?? null } : {}),
      ...(typeof parameters.status === "string" ? { status: parameters.status } : {}),
    });

    return {
      ok: true,
      account,
      status: workspace.getStatus(),
      task,
    };
  },
});
