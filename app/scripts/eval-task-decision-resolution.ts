import { parseAssistantDecisionReply } from "../src/core/assistant-decision.js";
import {
  resolveStructuredTaskOperationPayload,
  type StructuredTaskOperationResolutionResult,
  type TaskResolutionAccounts,
  type TaskResolutionWorkspace,
} from "../src/core/task-operation-resolution.js";
import type { TaskSummary } from "../src/integrations/google/google-workspace.js";

interface EvalCase {
  name: string;
  rawReply: Record<string, unknown>;
  recentMessages?: string[];
  expect:
    | {
        kind: "resolved";
        taskId?: string;
        taskListId?: string;
        account?: string;
      }
    | {
        kind: "clarify";
        includes: string;
      }
    | {
        kind: "invalid";
        includes: string;
      };
}

class FakeWorkspace implements TaskResolutionWorkspace {
  constructor(
    private readonly lists: Array<{ id: string; title: string }>,
    private readonly tasks: TaskSummary[],
  ) {}

  getStatus() {
    return { ready: true };
  }

  async listTaskLists(): Promise<Array<{ id: string; title: string }>> {
    return this.lists;
  }

  async listTasks(): Promise<TaskSummary[]> {
    return this.tasks;
  }
}

class FakeAccounts implements TaskResolutionAccounts {
  private readonly workspaces = new Map<string, TaskResolutionWorkspace>();

  constructor() {
    this.workspaces.set("primary", new FakeWorkspace(
      [{ id: "list_primary", title: "Pessoal" }],
      [
        {
          id: "task_alpha",
          taskListId: "list_primary",
          taskListTitle: "Pessoal",
          title: "Revisar agenda",
          status: "needsAction",
          due: null,
          updated: "2026-04-16T08:00:00.000Z",
        },
        {
          id: "task_beta",
          taskListId: "list_primary",
          taskListTitle: "Pessoal",
          title: "Enviar relatório",
          status: "needsAction",
          due: null,
          updated: "2026-04-16T08:30:00.000Z",
        },
      ],
    ));

    this.workspaces.set("abordagem", new FakeWorkspace(
      [{ id: "list_field", title: "Abordagem" }],
      [
        {
          id: "task_gamma",
          taskListId: "list_field",
          taskListTitle: "Abordagem",
          title: "Visita domiciliar",
          status: "needsAction",
          due: null,
          updated: "2026-04-16T09:00:00.000Z",
        },
        {
          id: "task_delta",
          taskListId: "list_field",
          taskListTitle: "Abordagem",
          title: "Revisar agenda",
          status: "needsAction",
          due: null,
          updated: "2026-04-16T09:10:00.000Z",
        },
      ],
    ));
  }

  getAliases(): string[] {
    return ["primary", "abordagem"];
  }

  resolveAlias(alias?: string): string {
    if (!alias) {
      return "primary";
    }
    return this.workspaces.has(alias) ? alias : "primary";
  }

  getWorkspace(alias?: string): TaskResolutionWorkspace {
    return this.workspaces.get(this.resolveAlias(alias)) as TaskResolutionWorkspace;
  }
}

function toFailure(result: StructuredTaskOperationResolutionResult): string {
  return JSON.stringify(result, null, 2);
}

async function resolveCase(item: EvalCase, accounts: TaskResolutionAccounts): Promise<{ passed: boolean; detail?: string }> {
  const parsed = parseAssistantDecisionReply(JSON.stringify(item.rawReply));
  if (parsed.kind !== "valid" || !parsed.decision.execution) {
    return {
      passed: item.expect.kind === "invalid",
      detail: parsed.kind === "invalid" ? parsed.error : `Unexpected parse result: ${parsed.kind}`,
    };
  }

  const result = await resolveStructuredTaskOperationPayload({
    payload: parsed.decision.execution.payload,
    recentMessages: item.recentMessages,
    accounts,
  });

  if (item.expect.kind === "resolved") {
    const payload = result.kind === "resolved" && typeof result.payload === "object"
      ? result.payload as Record<string, unknown>
      : undefined;
    const passed = result.kind === "resolved"
      && (item.expect.taskId ? payload?.task_id === item.expect.taskId : true)
      && (item.expect.taskListId ? payload?.task_list_id === item.expect.taskListId : true)
      && (item.expect.account ? payload?.account === item.expect.account : true);
    return {
      passed,
      detail: passed ? undefined : toFailure(result),
    };
  }

  if (item.expect.kind === "clarify") {
    const passed = result.kind === "clarify" && result.message.includes(item.expect.includes);
    return {
      passed,
      detail: passed ? undefined : toFailure(result),
    };
  }

  const invalidDetail = result.kind === "invalid" ? result.error : toFailure(result);
  return {
    passed: result.kind === "invalid" && invalidDetail.includes(item.expect.includes),
    detail: result.kind === "invalid" && invalidDetail.includes(item.expect.includes)
      ? undefined
      : invalidDetail,
  };
}

async function main() {
  const accounts = new FakeAccounts();
  const cases: EvalCase[] = [
    {
      name: "task_create_full_payload_stays_resolved",
      rawReply: {
        type: "assistant_decision",
        intent: "task_create",
        should_execute: true,
        assistant_reply: "Tarefa criada.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "create",
            title: "Planejar semana",
            task_list_id: "list_primary",
            account: "primary",
          },
        },
      },
      expect: {
        kind: "resolved",
        taskListId: "list_primary",
        account: "primary",
      },
    },
    {
      name: "task_update_full_payload_stays_resolved",
      rawReply: {
        type: "assistant_decision",
        intent: "task_update",
        should_execute: true,
        assistant_reply: "Tarefa atualizada.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "update",
            task_id: "task_alpha",
            task_list_id: "list_primary",
            account: "primary",
            status: "completed",
          },
        },
      },
      expect: {
        kind: "resolved",
        taskId: "task_alpha",
        taskListId: "list_primary",
        account: "primary",
      },
    },
    {
      name: "task_delete_full_payload_stays_resolved",
      rawReply: {
        type: "assistant_decision",
        intent: "task_delete",
        should_execute: true,
        assistant_reply: "Tarefa removida.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "delete",
            task_id: "task_gamma",
            task_list_id: "list_field",
            account: "abordagem",
          },
        },
      },
      expect: {
        kind: "resolved",
        taskId: "task_gamma",
        taskListId: "list_field",
        account: "abordagem",
      },
    },
    {
      name: "task_update_missing_task_list_id_is_resolved_from_single_list_context",
      rawReply: {
        type: "assistant_decision",
        intent: "task_update",
        should_execute: true,
        assistant_reply: "Tarefa concluída.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "update",
            task_id: "task_alpha",
            account: "primary",
            status: "completed",
          },
        },
      },
      expect: {
        kind: "resolved",
        taskId: "task_alpha",
        taskListId: "list_primary",
        account: "primary",
      },
    },
    {
      name: "task_delete_missing_task_list_id_is_resolved_from_unique_task_id",
      rawReply: {
        type: "assistant_decision",
        intent: "task_delete",
        should_execute: true,
        assistant_reply: "Tarefa removida.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "delete",
            task_id: "task_gamma",
          },
        },
      },
      expect: {
        kind: "resolved",
        taskId: "task_gamma",
        taskListId: "list_field",
        account: "abordagem",
      },
    },
    {
      name: "task_update_target_title_is_resolved_from_recent_list_context",
      rawReply: {
        type: "assistant_decision",
        intent: "task_update",
        should_execute: true,
        assistant_reply: "Tarefa atualizada.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "update",
            target_title: "Revisar agenda",
            task_list_title: "Pessoal",
            status: "completed",
          },
        },
      },
      recentMessages: ["Mostrei as tarefas da lista Pessoal agora há pouco."],
      expect: {
        kind: "resolved",
        taskId: "task_alpha",
        taskListId: "list_primary",
        account: "primary",
      },
    },
    {
      name: "task_update_ambiguous_title_requests_short_clarification",
      rawReply: {
        type: "assistant_decision",
        intent: "task_update",
        should_execute: true,
        assistant_reply: "Vou concluir a tarefa.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "update",
            target_title: "Revisar agenda",
            status: "completed",
          },
        },
      },
      expect: {
        kind: "clarify",
        includes: "Encontrei duas tarefas parecidas",
      },
    },
    {
      name: "task_delete_unknown_id_never_executes_automatically",
      rawReply: {
        type: "assistant_decision",
        intent: "task_delete",
        should_execute: true,
        assistant_reply: "Tarefa removida.",
        execution: {
          tool: "execute_task_operation",
          payload: {
            action: "delete",
            task_id: "task_missing",
          },
        },
      },
      expect: {
        kind: "clarify",
        includes: "Não encontrei essa tarefa com segurança",
      },
    },
  ];

  let passedCount = 0;
  const failures: Array<{ name: string; detail?: string }> = [];

  for (const item of cases) {
    const result = await resolveCase(item, accounts);
    if (result.passed) {
      passedCount += 1;
      console.log(`PASS ${item.name}`);
      continue;
    }
    failures.push({
      name: item.name,
      detail: result.detail,
    });
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`FAIL ${failure.name}`);
      if (failure.detail) {
        console.error(failure.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nTask decision resolution evals ok: ${passedCount}/${cases.length}`);
}

await main();
