import { defineToolPlugin } from "../types/plugin.js";

interface ExecuteTaskOperationParameters {
  action: "create" | "update" | "delete";
  account?: string;
  task_list_id?: string;
  task_id?: string;
  title?: string;
  notes?: string;
  due?: string | null;
  status?: string;
}

function hasTaskUpdateFields(parameters: ExecuteTaskOperationParameters): boolean {
  return ["title", "notes", "due", "status"].some((field) =>
    Object.prototype.hasOwnProperty.call(parameters, field)
  );
}

export default defineToolPlugin<ExecuteTaskOperationParameters>({
  name: "execute_task_operation",
  description:
    "Executes a structured Google Tasks operation after explicit confirmation in an external orchestration flow.",
  exposeToModel: false,
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["create", "update", "delete"],
        description: "Task operation to execute.",
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
      task_list_id: {
        type: "string",
        description: "Optional explicit Google Task list id.",
      },
      task_id: {
        type: "string",
        description: "Google Task id. Required for update and delete.",
      },
      title: {
        type: "string",
        description: "Task title. Required for create.",
      },
      notes: {
        type: "string",
        description: "Optional task notes.",
      },
      due: {
        type: ["string", "null"],
        description: "Optional RFC3339 due timestamp.",
      },
      status: {
        type: "string",
        description: "Updated Google Tasks status, for example needsAction or completed.",
      },
    },
    required: ["action"],
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
        action: parameters.action,
        status,
        error: "Google workspace is not ready.",
      };
    }

    if (!status.writeReady) {
      return {
        ok: false,
        account,
        action: parameters.action,
        status,
        error: "Google workspace is authenticated but missing write scopes.",
      };
    }

    if (parameters.action === "create") {
      if (!parameters.title?.trim()) {
        return {
          ok: false,
          account,
          action: parameters.action,
          status,
          error: "Create operations require title.",
        };
      }

      const task = await workspace.createTask({
        title: parameters.title,
        ...(typeof parameters.notes === "string" ? { notes: parameters.notes } : {}),
        ...(Object.prototype.hasOwnProperty.call(parameters, "due") ? { due: parameters.due ?? undefined } : {}),
        ...(parameters.task_list_id ? { taskListId: parameters.task_list_id } : {}),
      });

      return {
        ok: true,
        account,
        action: parameters.action,
        status: workspace.getStatus(),
        task,
      };
    }

    if (!parameters.task_id?.trim() || !parameters.task_list_id?.trim()) {
      return {
        ok: false,
        account,
        action: parameters.action,
        status,
        error: `${parameters.action === "update" ? "Update" : "Delete"} operations require task_id and task_list_id.`,
      };
    }

    if (parameters.action === "update") {
      if (!hasTaskUpdateFields(parameters)) {
        return {
          ok: false,
          account,
          action: parameters.action,
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
        action: parameters.action,
        status: workspace.getStatus(),
        task,
      };
    }

    const task = await workspace.deleteTask({
      taskId: parameters.task_id,
      taskListId: parameters.task_list_id,
    });

    return {
      ok: true,
      account,
      action: parameters.action,
      status: workspace.getStatus(),
      task,
    };
  },
});
