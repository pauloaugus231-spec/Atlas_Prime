import { createAgentCore } from "./core/create-agent-core.js";
import { FileAccessPolicy } from "./core/file-access-policy.js";
import { EvolutionApiClient } from "./integrations/whatsapp/evolution-api.js";

function printUsage(): void {
  console.log([
    "Uso:",
    "  npm run core:doctor",
    "  npm run core:plugins",
    "  npm run core:memory",
    "  npm run google:auth",
    '  npm run core:chat -- --prompt "sua mensagem"',
  ].join("\n"));
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  const {
    config,
    logger,
    loadedPlugins,
    client,
    core,
    memory,
    preferences,
    email,
    emailWriter,
    emailAccounts,
    googleWorkspace,
    googleWorkspaces,
    growthOps,
    safeExec,
    contacts,
    approvals,
    macCommandQueue,
  } = await createAgentCore();

  if (command === "doctor") {
    const models = await client.listModels();
    const fileAccess = new FileAccessPolicy(config.paths.workspaceDir, config.paths.authorizedProjectsDir);
    const whatsapp = new EvolutionApiClient(config.whatsapp, logger.child({ scope: "whatsapp-evolution" }));
    console.log(
      JSON.stringify(
        {
          status: "ok",
          provider: config.llm.provider,
          model: config.llm.model,
          llmBaseUrl: config.llm.baseUrl,
          loadedPlugins: loadedPlugins.map((item) => ({
            name: item.plugin.name,
            origin: item.origin,
            sourcePath: item.sourcePath,
          })),
          availableModels: models,
          readableRoots: fileAccess.describeReadableRoots(),
          memoryDbPath: config.paths.memoryDbPath,
          growthDbPath: config.paths.growthDbPath,
          contentDbPath: config.paths.contentDbPath,
          socialAssistantDbPath: config.paths.socialAssistantDbPath,
          contactIntelligenceDbPath: config.paths.contactIntelligenceDbPath,
          approvalInboxDbPath: config.paths.approvalInboxDbPath,
          supabaseMacQueue: macCommandQueue.getStatus(),
          memorySummary: memory.getContextSummary(),
          userPreferences: preferences.get(),
          savedContacts: contacts.listContacts(10).length,
          pendingApprovals: approvals.listPending(config.telegram.allowedUserIds[0] ?? 0, 20).length,
          pendingApprovalsAll: approvals.listPendingAll(20).length,
          emailStatus: await email.getStatus(),
          emailDeliveryStatus: await emailWriter.getStatus(),
          emailAccounts: emailAccounts.getAliases(),
          googleWorkspaceStatus: googleWorkspace.getStatus(),
          googleAccounts: googleWorkspaces.getAliases(),
          whatsappStatus: whatsapp.getStatus(),
          safeExecStatus: safeExec.getStatus(),
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "plugins:list") {
    console.log(
      JSON.stringify(
        loadedPlugins.map((item) => ({
          name: item.plugin.name,
          description: item.plugin.description,
          origin: item.origin,
          sourcePath: item.sourcePath,
        })),
        null,
        2,
      ),
    );
    return;
  }

  if (command === "chat") {
    const prompt = readFlagValue(args, "--prompt") ?? args.slice(1).join(" ").trim();
    if (!prompt) {
      throw new Error("Missing prompt. Use --prompt \"...\"");
    }

    const result = await core.runUserPrompt(prompt);
    console.log(
      JSON.stringify(
        {
          requestId: result.requestId,
          reply: result.reply,
          toolExecutions: result.toolExecutions,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === "memory:list") {
    console.log(
      JSON.stringify(
        {
          items: memory.listItems({
            limit: 50,
          }),
        },
        null,
        2,
      ),
    );
    return;
  }

  printUsage();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
