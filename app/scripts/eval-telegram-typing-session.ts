import { setTimeout as delay } from "node:timers/promises";
import { TelegramTypingSession } from "../src/integrations/telegram/typing-session.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

async function run(): Promise<void> {
  const events: string[] = [];
  const session = new TelegramTypingSession({
    startDelayMs: 30,
    heartbeatMs: 40,
    progressDelayMs: 80,
    fallbackDelayMs: 150,
    progressText: "Estou vendo isso agora.",
    fallbackText: "Isso está demorando mais do que deveria.",
    sendTyping: async () => {
      events.push("typing");
    },
    sendProgress: async (text) => {
      events.push(text);
    },
  });

  session.start();
  await delay(190);
  await session.stop();

  const results: EvalResult[] = [
    {
      name: "typing_starts_after_delay",
      passed: events.includes("typing"),
      detail: JSON.stringify(events),
    },
    {
      name: "progress_message_is_sent_once",
      passed: events.filter((item) => item === "Estou vendo isso agora.").length === 1,
      detail: JSON.stringify(events),
    },
    {
      name: "fallback_message_is_sent_once",
      passed: events.filter((item) => item === "Isso está demorando mais do que deveria.").length === 1,
      detail: JSON.stringify(events),
    },
  ];

  const failure = results.find((item) => !item.passed);
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
  }

  if (failure) {
    process.exitCode = 1;
    return;
  }

  console.log(`\nTelegram typing session evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
