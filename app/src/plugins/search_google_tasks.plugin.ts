import { defineToolPlugin } from "../types/plugin.js";

interface SearchGoogleTasksParameters {
  account?: string;
  max_results?: number;
  show_completed?: boolean;
  due_before?: string;
  due_after?: string;
  task_list_id?: string;
}

export default defineToolPlugin<SearchGoogleTasksParameters>({
  name: "search_google_tasks",
  description:
    "Compatibility alias for listing Google Tasks items in read-only mode.",
  parameters: {
    type: "object",
    properties: {
      max_results: {
        type: "integer",
        default: 15,
        minimum: 1,
        maximum: 50,
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
      show_completed: {
        type: "boolean",
        default: false,
      },
      due_before: {
        type: "string",
        description: "Optional RFC3339 upper bound for due date filtering.",
      },
      due_after: {
        type: "string",
        description: "Optional RFC3339 lower bound for due date filtering.",
      },
      task_list_id: {
        type: "string",
      },
    },
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
        tasks: [],
      };
    }

    const tasks = await workspace.listTasks({
      maxResults: parameters.max_results,
      showCompleted: parameters.show_completed,
      dueBefore: parameters.due_before,
      dueAfter: parameters.due_after,
      taskListId: parameters.task_list_id,
    });

    return {
      ok: true,
      account,
      status,
      total: tasks.length,
      tasks,
    };
  },
});
