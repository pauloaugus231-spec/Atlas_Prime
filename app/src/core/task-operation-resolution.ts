import type { TaskSummary } from "../integrations/google/google-workspace.js";

type TaskAction = "create" | "update" | "delete";

export interface TaskResolutionWorkspace {
  getStatus(): { ready: boolean };
  listTaskLists(): Promise<Array<{ id: string; title: string }>>;
  listTasks(input?: {
    maxResults?: number;
    showCompleted?: boolean;
    taskListId?: string;
  }): Promise<TaskSummary[]>;
}

export interface TaskResolutionAccounts {
  getAliases(): string[];
  resolveAlias(alias?: string): string;
  getWorkspace(alias?: string): TaskResolutionWorkspace;
}

export interface StructuredTaskOperationResolutionInput {
  payload: Record<string, unknown>;
  recentMessages?: string[];
  accounts: TaskResolutionAccounts;
}

export type StructuredTaskOperationResolutionResult =
  | {
      kind: "resolved";
      payload: Record<string, unknown>;
    }
  | {
      kind: "clarify";
      message: string;
    }
  | {
      kind: "invalid";
      error: string;
    };

interface AvailableTaskList {
  account: string;
  id: string;
  title: string;
}

interface AvailableTaskItem extends TaskSummary {
  account: string;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getString(payload: Record<string, unknown>, key: string): string | undefined {
  return hasNonEmptyString(payload[key]) ? payload[key].trim() : undefined;
}

function getDue(payload: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(payload, "due")) {
    return undefined;
  }
  const due = payload.due;
  if (due === null) {
    return null;
  }
  return hasNonEmptyString(due) ? due.trim() : undefined;
}

function hasUsefulTaskUpdateField(payload: Record<string, unknown>): boolean {
  return ["title", "notes", "due", "status"].some((field) =>
    Object.prototype.hasOwnProperty.call(payload, field)
  );
}

function aliasLabels(alias: string): string[] {
  if (alias === "primary") {
    return ["primary", "principal", "pessoal"];
  }
  return [alias, alias.replace(/_/g, " ")];
}

function inferAccountHints(recentMessages: string[], aliases: string[]): string[] {
  if (recentMessages.length === 0) {
    return [];
  }

  const haystack = normalize(recentMessages.join(" \n "));
  return aliases.filter((alias) => aliasLabels(alias).some((label) => haystack.includes(normalize(label))));
}

async function collectTaskContext(
  accounts: TaskResolutionAccounts,
  aliases: string[],
): Promise<{ lists: AvailableTaskList[]; tasks: AvailableTaskItem[] }> {
  const lists: AvailableTaskList[] = [];
  const tasks: AvailableTaskItem[] = [];

  for (const alias of aliases) {
    const workspace = accounts.getWorkspace(alias);
    if (!workspace.getStatus().ready) {
      continue;
    }

    const accountLists = await workspace.listTaskLists();
    lists.push(
      ...accountLists.map((item) => ({
        account: alias,
        id: item.id,
        title: item.title,
      })),
    );

    const accountTasks = await workspace.listTasks({
      maxResults: 30,
      showCompleted: true,
    });
    tasks.push(
      ...accountTasks.map((task) => ({
        ...task,
        account: alias,
      })),
    );
  }

  return { lists, tasks };
}

function sanitizeResolvedPayload(
  payload: Record<string, unknown>,
  resolved: {
    action: TaskAction;
    account?: string;
    taskListId?: string;
    taskId?: string;
  },
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    action: resolved.action,
  };

  if (resolved.account) {
    sanitized.account = resolved.account;
  }
  if (resolved.taskListId) {
    sanitized.task_list_id = resolved.taskListId;
  }
  if (resolved.taskId) {
    sanitized.task_id = resolved.taskId;
  }

  if (hasNonEmptyString(payload.title)) {
    sanitized.title = payload.title.trim();
  }
  if (typeof payload.notes === "string") {
    sanitized.notes = payload.notes;
  }
  if (typeof payload.status === "string") {
    sanitized.status = payload.status;
  }

  const due = getDue(payload);
  if (due !== undefined) {
    sanitized.due = due;
  }

  return sanitized;
}

function buildTaskListClarification(action: Exclude<TaskAction, "create">, lists: AvailableTaskList[]): string {
  const verb = action === "update" ? "atualizar" : "remover";
  const labels = [...new Set(lists.map((item) => item.title.trim()).filter(Boolean))].slice(0, 3);
  if (labels.length >= 2) {
    return `Preciso saber em qual lista devo ${verb} essa tarefa: ${labels.join(" ou ")}?`;
  }
  return `Preciso saber em qual lista devo ${verb} essa tarefa.`;
}

function resolveTaskListByTitle(
  lists: AvailableTaskList[],
  titleHint?: string,
): AvailableTaskList | null | undefined {
  if (!titleHint) {
    return undefined;
  }

  const normalizedHint = normalize(titleHint);
  const exactMatches = lists.filter((item) => normalize(item.title) === normalizedHint);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    return null;
  }

  const partialMatches = lists.filter((item) => normalize(item.title).includes(normalizedHint));
  if (partialMatches.length === 1) {
    return partialMatches[0];
  }
  if (partialMatches.length > 1) {
    return null;
  }

  return undefined;
}

function resolveTaskById(tasks: AvailableTaskItem[], taskId?: string): AvailableTaskItem | null | undefined {
  if (!taskId) {
    return undefined;
  }
  const matches = tasks.filter((item) => item.id === taskId);
  if (matches.length === 1) {
    return matches[0];
  }
  return matches.length > 1 ? null : undefined;
}

function resolveTaskByTitle(tasks: AvailableTaskItem[], targetTitle?: string): AvailableTaskItem | null | undefined {
  if (!targetTitle) {
    return undefined;
  }

  const normalizedTarget = normalize(targetTitle);
  const exactMatches = tasks.filter((item) => normalize(item.title) === normalizedTarget);
  if (exactMatches.length === 1) {
    return exactMatches[0];
  }
  if (exactMatches.length > 1) {
    return null;
  }

  if (normalizedTarget.length < 4) {
    return undefined;
  }

  const partialMatches = tasks.filter((item) => normalize(item.title).includes(normalizedTarget));
  if (partialMatches.length === 1) {
    return partialMatches[0];
  }
  return partialMatches.length > 1 ? null : undefined;
}

function buildTaskClarification(action: Exclude<TaskAction, "create">, tasks: AvailableTaskItem[]): string {
  const verb = action === "update" ? "atualizar" : "concluir/remover";
  const options = tasks.slice(0, 2).map((item) => item.title || "(sem titulo)");
  if (options.length >= 2) {
    return `Encontrei duas tarefas parecidas. Qual delas você quer ${verb}: ${options.join(" ou ")}?`;
  }
  return `Preciso saber qual tarefa você quer ${verb}.`;
}

function filterTasksByResolvedList(tasks: AvailableTaskItem[], taskListId?: string, account?: string): AvailableTaskItem[] {
  return tasks.filter((item) =>
    (!taskListId || item.taskListId === taskListId) && (!account || item.account === account)
  );
}

export async function resolveStructuredTaskOperationPayload(
  input: StructuredTaskOperationResolutionInput,
): Promise<StructuredTaskOperationResolutionResult> {
  const action = getString(input.payload, "action");
  if (action !== "create" && action !== "update" && action !== "delete") {
    return {
      kind: "invalid",
      error: "execute_task_operation payload.action must be create, update or delete.",
    };
  }

  if (action === "create") {
    if (!hasNonEmptyString(input.payload.title)) {
      return {
        kind: "invalid",
        error: "Task create operations require title.",
      };
    }

    const account = getString(input.payload, "account");
    return {
      kind: "resolved",
      payload: sanitizeResolvedPayload(input.payload, {
        action,
        ...(account ? { account: input.accounts.resolveAlias(account) } : {}),
        ...(getString(input.payload, "task_list_id") ? { taskListId: getString(input.payload, "task_list_id") } : {}),
      }),
    };
  }

  if (action === "update" && !hasUsefulTaskUpdateField(input.payload)) {
    return {
      kind: "invalid",
      error: "Task update operations require at least one field to change.",
    };
  }

  const explicitAccount = getString(input.payload, "account");
  const aliasesFromContext = inferAccountHints(input.recentMessages ?? [], input.accounts.getAliases());
  const candidateAliases = explicitAccount
    ? [input.accounts.resolveAlias(explicitAccount)]
    : aliasesFromContext.length === 1
      ? aliasesFromContext
      : input.accounts.getAliases();

  const { lists, tasks } = await collectTaskContext(input.accounts, candidateAliases);
  if (lists.length === 0 && tasks.length === 0) {
    return {
      kind: "invalid",
      error: "No Google Tasks context is available for structured execution.",
    };
  }

  const explicitTaskId = getString(input.payload, "task_id");
  const explicitTaskListId = getString(input.payload, "task_list_id");
  const explicitTaskListTitle = getString(input.payload, "task_list_title");
  const targetTitle = getString(input.payload, "target_title");

  let resolvedAccount = explicitAccount ? input.accounts.resolveAlias(explicitAccount) : undefined;
  let resolvedTaskListId = explicitTaskListId;
  let resolvedTaskId = explicitTaskId;

  const resolvedListFromTitle = resolveTaskListByTitle(lists, explicitTaskListTitle);
  if (resolvedListFromTitle === null) {
    return {
      kind: "clarify",
      message: buildTaskListClarification(action, lists),
    };
  }
  if (!resolvedTaskListId && resolvedListFromTitle) {
    resolvedTaskListId = resolvedListFromTitle.id;
    resolvedAccount = resolvedListFromTitle.account;
  }

  const resolvedTaskFromId = resolveTaskById(tasks, resolvedTaskId);
  if (resolvedTaskFromId === null) {
    return {
      kind: "clarify",
      message: buildTaskListClarification(action, lists),
    };
  }
  if (resolvedTaskId && !resolvedTaskFromId) {
    return {
      kind: "clarify",
      message: "Não encontrei essa tarefa com segurança. Me diga o título exato ou a lista.",
    };
  }
  if (!resolvedTaskListId && resolvedTaskFromId) {
    resolvedTaskListId = resolvedTaskFromId.taskListId;
    resolvedAccount = resolvedTaskFromId.account;
  }

  if (!resolvedTaskListId && lists.length === 1) {
    resolvedTaskListId = lists[0].id;
    resolvedAccount = lists[0].account;
  }

  const candidateTasks = filterTasksByResolvedList(tasks, resolvedTaskListId, resolvedAccount);
  if (!resolvedTaskId) {
    const resolvedTaskFromTitle = resolveTaskByTitle(candidateTasks.length > 0 ? candidateTasks : tasks, targetTitle);
    if (resolvedTaskFromTitle === null) {
      const ambiguousPool = (candidateTasks.length > 0 ? candidateTasks : tasks)
        .filter((item) => targetTitle ? normalize(item.title).includes(normalize(targetTitle)) : true);
      return {
        kind: "clarify",
        message: buildTaskClarification(action, ambiguousPool),
      };
    }

    if (resolvedTaskFromTitle) {
      resolvedTaskId = resolvedTaskFromTitle.id;
      resolvedTaskListId = resolvedTaskFromTitle.taskListId;
      resolvedAccount = resolvedTaskFromTitle.account;
    }
  }

  if (!resolvedTaskListId) {
    return {
      kind: "clarify",
      message: buildTaskListClarification(action, lists),
    };
  }

  if (!resolvedTaskId) {
    return {
      kind: "clarify",
      message: targetTitle
        ? `Não encontrei essa tarefa com segurança. Me diga o título exato ou a lista.`
        : `Preciso saber qual tarefa você quer ${action === "update" ? "atualizar" : "remover"}.`,
    };
  }

  const confirmedTask = tasks.find((item) =>
    item.id === resolvedTaskId
    && item.taskListId === resolvedTaskListId
    && (!resolvedAccount || item.account === resolvedAccount)
  );

  if (!confirmedTask) {
    return {
      kind: "clarify",
      message: "Não encontrei essa tarefa com segurança. Me diga o título exato ou a lista.",
    };
  }

  return {
    kind: "resolved",
    payload: sanitizeResolvedPayload(input.payload, {
      action,
      account: confirmedTask.account,
      taskListId: confirmedTask.taskListId,
      taskId: confirmedTask.id,
    }),
  };
}
