import process from "node:process";
import { loadConfig } from "../src/config/load-config.js";
import { FallbackLlmClient } from "../src/core/fallback-llm-client.js";
import type { LlmChatResponse, LlmClient } from "../src/types/llm.js";
import type { Logger } from "../src/types/logger.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

class MemoryLogger implements Logger {
  warnings: string[] = [];

  debug(): void {}
  info(): void {}
  error(): void {}

  warn(message: string): void {
    this.warnings.push(message);
  }

  child(): Logger {
    return this;
  }
}

class FakeLlmClient implements LlmClient {
  chatCalls = 0;

  constructor(
    private readonly response: LlmChatResponse | Error,
    private readonly models: string[] = [],
  ) {}

  async listModels(): Promise<string[]> {
    return this.models;
  }

  async chat(): Promise<LlmChatResponse> {
    this.chatCalls += 1;
    if (this.response instanceof Error) {
      throw this.response;
    }
    return this.response;
  }
}

function response(content: string, model = "fake"): LlmChatResponse {
  return {
    model,
    done: true,
    message: {
      role: "assistant",
      content,
    },
  };
}

async function run() {
  const results: EvalResult[] = [];

  {
    const logger = new MemoryLogger();
    const primary = new FakeLlmClient(response("resposta local", "qwen3:8b"));
    const secondary = new FakeLlmClient(response("fallback openai", "gpt-5-mini"));
    const client = new FallbackLlmClient(primary, secondary, logger, {
      primaryLabel: "ollama:qwen3:8b",
      secondaryLabel: "openai:gpt-5-mini",
    });
    const result = await client.chat({ messages: [{ role: "user", content: "oi" }] });
    results.push({
      name: "primary_success_does_not_call_fallback",
      passed: result.message.content === "resposta local" && primary.chatCalls === 1 && secondary.chatCalls === 0,
    });
  }

  {
    const logger = new MemoryLogger();
    const primary = new FakeLlmClient(new Error("ollama offline"));
    const secondary = new FakeLlmClient(response("fallback openai", "gpt-5-mini"));
    const client = new FallbackLlmClient(primary, secondary, logger, {
      primaryLabel: "ollama:qwen3:8b",
      secondaryLabel: "openai:gpt-5-mini",
    });
    const result = await client.chat({ messages: [{ role: "user", content: "oi" }] });
    results.push({
      name: "primary_error_calls_fallback",
      passed: result.message.content === "fallback openai" && primary.chatCalls === 1 && secondary.chatCalls === 1,
    });
  }

  {
    const logger = new MemoryLogger();
    const primary = new FakeLlmClient(response("", "qwen3:8b"));
    const secondary = new FakeLlmClient(response("fallback openai", "gpt-5-mini"));
    const client = new FallbackLlmClient(primary, secondary, logger, {
      primaryLabel: "ollama:qwen3:8b",
      secondaryLabel: "openai:gpt-5-mini",
    });
    const result = await client.chat({ messages: [{ role: "user", content: "oi" }] });
    results.push({
      name: "empty_primary_response_calls_fallback",
      passed: result.message.content === "fallback openai" && primary.chatCalls === 1 && secondary.chatCalls === 1,
    });
  }

  {
    const config = loadConfig({
      LLM_PROVIDER: "fallback",
      LLM_PRIMARY_PROVIDER: "ollama",
      LLM_FALLBACK_PROVIDER: "openai",
      OLLAMA_MODEL: "qwen3:8b",
      OPENAI_API_KEY: "test-key",
    });
    results.push({
      name: "config_supports_ollama_first_openai_fallback",
      passed:
        config.llm.provider === "fallback" &&
        config.llm.fallback?.primary.provider === "ollama" &&
        config.llm.fallback.primary.model === "qwen3:8b" &&
        config.llm.fallback.secondary.provider === "openai" &&
        Boolean(config.llm.openai?.apiKey),
    });
  }

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

  console.log(`\nLLM fallback evals ok: ${results.length}/${results.length}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
