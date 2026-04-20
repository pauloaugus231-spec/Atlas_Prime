import { createAgentCore } from "../../core/create-agent-core.js";
import { TelegramApi } from "./telegram-api.js";
import { TelegramService } from "./telegram-service.js";

async function main(): Promise<void> {
  const {
    config,
    logger,
    core,
    requestOrchestrator,
    contentOps,
    approvalEngine,
    clarificationEngine,
    whatsappMessages,
    googleAuth,
  } = await createAgentCore();

  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const abortController = new AbortController();
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info("Shutting down Telegram service", { signal });
    abortController.abort();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const api = new TelegramApi(config.telegram.botToken);
  const service = new TelegramService(
    config,
    logger.child({ scope: "telegram" }),
    core,
    requestOrchestrator,
    contentOps,
    googleAuth,
    api,
    approvalEngine,
    clarificationEngine,
    whatsappMessages,
  );

  await service.start(abortController.signal);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
