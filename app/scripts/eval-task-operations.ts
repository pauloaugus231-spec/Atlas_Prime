import process from "node:process";
import createGoogleTaskPlugin from "../src/plugins/create_google_task.plugin.js";
import deleteGoogleTaskPlugin from "../src/plugins/delete_google_task.plugin.js";
import updateGoogleTaskPlugin from "../src/plugins/update_google_task.plugin.js";
import executeTaskOperationPlugin from "../src/plugins/execute_task_operation.plugin.js";
import type { ToolExecutionContext } from "../src/types/plugin.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function buildContext(input: {
  ready: boolean;
  writeReady: boolean;
}) {
  const workspace = {
    getStatus: () => ({
      ready: input.ready,
      writeReady: input.writeReady,
    }),
    createTask: async (payload: Record<string, unknown>) => ({
      id: "task-1",
      title: String(payload.title ?? ""),
      taskListId: String(payload.taskListId ?? "default"),
      status: "needsAction",
      due: typeof payload.due === "string" ? payload.due : null,
    }),
    updateTask: async (payload: Record<string, unknown>) => ({
      id: String(payload.taskId ?? "task-1"),
      title: String(payload.title ?? "Atualizada"),
      taskListId: String(payload.taskListId ?? "default"),
      status: String(payload.status ?? "needsAction"),
      due: typeof payload.due === "string" ? payload.due : null,
    }),
    deleteTask: async (payload: Record<string, unknown>) => ({
      id: String(payload.taskId ?? "task-1"),
      taskListId: String(payload.taskListId ?? "default"),
      status: "deleted",
    }),
  };

  return {
    googleWorkspaces: {
      resolveAlias: (alias?: string) => alias ?? "primary",
      getWorkspace: () => workspace,
    },
  } as unknown as ToolExecutionContext;
}

async function run() {
  const results: EvalResult[] = [];

  const notReady = await createGoogleTaskPlugin.execute(
    { title: "Nova tarefa" },
    buildContext({ ready: false, writeReady: false }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_create_requires_ready",
    passed: notReady.ok === false && notReady.error === "Google workspace is not ready.",
    detail: JSON.stringify(notReady, null, 2),
  });

  const writeMissing = await deleteGoogleTaskPlugin.execute(
    { task_id: "task-1", task_list_id: "default" },
    buildContext({ ready: true, writeReady: false }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_delete_requires_write_scope",
    passed: writeMissing.ok === false && writeMissing.error === "Google workspace is authenticated but missing write scopes.",
    detail: JSON.stringify(writeMissing, null, 2),
  });

  const createExecution = await executeTaskOperationPlugin.execute(
    {
      action: "create",
      title: "Revisar agenda",
      due: "2026-04-17T12:00:00-03:00",
    },
    buildContext({ ready: true, writeReady: true }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_executor_create_ok",
    passed: createExecution.ok === true && createExecution.action === "create",
    detail: JSON.stringify(createExecution, null, 2),
  });

  const updateExecution = await executeTaskOperationPlugin.execute(
    {
      action: "update",
      task_id: "task-1",
      task_list_id: "default",
      title: "Agenda revisada",
      status: "completed",
    },
    buildContext({ ready: true, writeReady: true }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_executor_update_ok",
    passed: updateExecution.ok === true && updateExecution.action === "update",
    detail: JSON.stringify(updateExecution, null, 2),
  });

  const deleteExecution = await executeTaskOperationPlugin.execute(
    {
      action: "delete",
      task_id: "task-1",
      task_list_id: "default",
    },
    buildContext({ ready: true, writeReady: true }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_executor_delete_ok",
    passed: deleteExecution.ok === true && deleteExecution.action === "delete",
    detail: JSON.stringify(deleteExecution, null, 2),
  });

  const invalidCreate = await executeTaskOperationPlugin.execute(
    {
      action: "create",
    },
    buildContext({ ready: true, writeReady: true }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_executor_create_requires_title",
    passed: invalidCreate.ok === false && invalidCreate.error === "Create operations require title.",
    detail: JSON.stringify(invalidCreate, null, 2),
  });

  const invalidExecutorUpdate = await executeTaskOperationPlugin.execute(
    {
      action: "update",
      task_id: "task-2",
      task_list_id: "default",
    },
    buildContext({ ready: true, writeReady: true }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_executor_update_requires_changes",
    passed: invalidExecutorUpdate.ok === false && invalidExecutorUpdate.error === "Update operations require at least one field to change.",
    detail: JSON.stringify(invalidExecutorUpdate, null, 2),
  });

  const validUpdate = await updateGoogleTaskPlugin.execute(
    {
      task_id: "task-2",
      task_list_id: "default",
      title: "Atualizada",
    },
    buildContext({ ready: true, writeReady: true }),
  ) as Record<string, unknown>;
  results.push({
    name: "task_update_plugin_ok",
    passed: validUpdate.ok === true && typeof validUpdate.task === "object",
    detail: JSON.stringify(validUpdate, null, 2),
  });

  const failures = results.filter((item) => !item.passed);
  for (const item of results.filter((entry) => entry.passed)) {
    console.log(`PASS ${item.name}`);
  }

  if (failures.length > 0) {
    console.error("");
    for (const item of failures) {
      console.error(`FAIL ${item.name}`);
      if (item.detail) {
        console.error(item.detail);
      }
      console.error("");
    }
    process.exitCode = 1;
    return;
  }

  console.log(`\nTask operation evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
