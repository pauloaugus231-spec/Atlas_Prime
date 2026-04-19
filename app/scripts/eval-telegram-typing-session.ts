import { setTimeout as delay } from "node:timers/promises";
import { ChatPresenceSession } from "../src/integrations/presence/chat-presence.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

async function runFastRequestNoPresenceEval(): Promise<EvalResult> {
  const events: string[] = [];
  const session = new ChatPresenceSession({
    channel: "telegram",
    flow: "fast_request",
    config: {
      enabled: true,
      startDelayMs: 80,
      refreshIntervalMs: 40,
      progressDelayMs: 150,
      maxDurationMs: 220,
    },
    progressText: "Estou vendo isso agora.",
    timeoutText: "Isso está demorando mais do que deveria.",
    sendPresence: async () => {
      events.push("typing");
    },
    sendProgress: async (text) => {
      events.push(text);
    },
  });

  session.start();
  await delay(30);
  await session.stop("completed");
  await delay(120);

  return {
    name: "fast_request_does_not_start_presence",
    passed: events.length === 0,
    detail: JSON.stringify(events),
  };
}

async function runSlowRequestPresenceEval(): Promise<EvalResult[]> {
  const events: Array<{ kind: string; at: number }> = [];
  const startedAt = Date.now();
  const session = new ChatPresenceSession({
    channel: "telegram",
    flow: "slow_request",
    config: {
      enabled: true,
      startDelayMs: 20,
      refreshIntervalMs: 35,
      progressDelayMs: 120,
      maxDurationMs: 260,
    },
    progressText: "Estou vendo isso agora.",
    timeoutText: "Isso está demorando mais do que deveria.",
    sendPresence: async () => {
      events.push({ kind: "typing", at: Date.now() - startedAt });
    },
    sendProgress: async (text) => {
      events.push({ kind: text, at: Date.now() - startedAt });
    },
  });

  session.start();
  await delay(90);
  await session.stop("completed");
  const countBeforeWait = events.length;
  await delay(120);
  const typingCount = events.filter((item) => item.kind === "typing").length;

  return [
    {
      name: "slow_request_starts_presence",
      passed: typingCount >= 1,
      detail: JSON.stringify(events),
    },
    {
      name: "presence_stops_after_response",
      passed: events.length === countBeforeWait,
      detail: JSON.stringify(events),
    },
  ];
}

async function runTimeoutEval(): Promise<EvalResult[]> {
  const events: Array<{ kind: string; at: number }> = [];
  const startedAt = Date.now();
  const session = new ChatPresenceSession({
    channel: "telegram",
    flow: "timeout_request",
    config: {
      enabled: true,
      startDelayMs: 15,
      refreshIntervalMs: 30,
      progressDelayMs: 60,
      maxDurationMs: 110,
    },
    progressText: "Estou vendo isso agora.",
    timeoutText: "Isso está demorando mais do que deveria.",
    sendPresence: async () => {
      events.push({ kind: "typing", at: Date.now() - startedAt });
    },
    sendProgress: async (text) => {
      events.push({ kind: text, at: Date.now() - startedAt });
    },
  });

  session.start();
  await delay(170);
  const countAtTimeout = events.length;
  await delay(90);
  const typingAfterTimeout = events
    .slice(countAtTimeout)
    .filter((item) => item.kind === "typing").length;

  return [
    {
      name: "timeout_sends_progress_message",
      passed: events.filter((item) => item.kind === "Estou vendo isso agora.").length === 1,
      detail: JSON.stringify(events),
    },
    {
      name: "timeout_sends_fallback_message_once",
      passed: events.filter((item) => item.kind === "Isso está demorando mais do que deveria.").length === 1,
      detail: JSON.stringify(events),
    },
    {
      name: "timeout_stops_presence_loop",
      passed: typingAfterTimeout === 0,
      detail: JSON.stringify(events),
    },
  ];
}

async function run(): Promise<void> {
  const results: EvalResult[] = [
    await runFastRequestNoPresenceEval(),
    ...(await runSlowRequestPresenceEval()),
    ...(await runTimeoutEval()),
  ];

  const failure = results.find((item) => !item.passed);
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.name}${result.detail ? ` :: ${result.detail}` : ""}`);
  }

  if (failure) {
    process.exitCode = 1;
    return;
  }

  console.log(`\nTelegram presence evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
