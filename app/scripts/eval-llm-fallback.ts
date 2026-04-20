import process from "node:process";
import { loadConfig } from "../src/config/load-config.js";
import { FallbackLlmClient } from "../src/core/fallback-llm-client.js";
import { SmartRoutingLlmClient } from "../src/core/smart-routing-llm-client.js";
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
    const primary = new FakeLlmClient(response("resposta local", "qwen3:1.7b"));
    const secondary = new FakeLlmClient(response("fallback openai", "gpt-5.4-mini"));
    const client = new FallbackLlmClient(primary, secondary, logger, {
      primaryLabel: "ollama:qwen3:1.7b",
      secondaryLabel: "openai:gpt-5.4-mini",
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
    const secondary = new FakeLlmClient(response("fallback openai", "gpt-5.4-mini"));
    const client = new FallbackLlmClient(primary, secondary, logger, {
      primaryLabel: "ollama:qwen3:1.7b",
      secondaryLabel: "openai:gpt-5.4-mini",
    });
    const result = await client.chat({ messages: [{ role: "user", content: "oi" }] });
    results.push({
      name: "primary_error_calls_fallback",
      passed: result.message.content === "fallback openai" && primary.chatCalls === 1 && secondary.chatCalls === 1,
    });
  }

  {
    const logger = new MemoryLogger();
    const primary = new FakeLlmClient(response("", "qwen3:1.7b"));
    const secondary = new FakeLlmClient(response("fallback openai", "gpt-5.4-mini"));
    const client = new FallbackLlmClient(primary, secondary, logger, {
      primaryLabel: "ollama:qwen3:1.7b",
      secondaryLabel: "openai:gpt-5.4-mini",
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
      LLM_PRIMARY_PROVIDER: "openai",
      LLM_FALLBACK_PROVIDER: "ollama",
      LLM_SMART_ROUTING_ENABLED: "true",
      OLLAMA_MODEL: "qwen3:1.7b",
      OPENAI_MODEL: "gpt-5.4-mini",
      OPENAI_ADVANCED_MODEL: "gpt-5.4",
      OPENAI_API_KEY: "test-key",
    });
    results.push({
      name: "config_supports_openai_mini_full_and_ollama_chain",
      passed:
        config.llm.provider === "fallback" &&
        config.llm.fallback?.primary.provider === "openai" &&
        config.llm.fallback.primary.model === "gpt-5.4-mini" &&
        config.llm.fallback.secondary.provider === "ollama" &&
        config.llm.advanced?.provider === "openai" &&
        config.llm.advanced.model === "gpt-5.4" &&
        config.llm.smartRouting?.enabled === true &&
        Boolean(config.llm.openai?.apiKey),
    });
  }

  {
    const logger = new MemoryLogger();
    const mini = new FakeLlmClient(response("mini", "gpt-5.4-mini"));
    const advanced = new FakeLlmClient(response("advanced", "gpt-5.4"));
    const ollama = new FakeLlmClient(response("ollama", "qwen3:1.7b"));
    const client = new SmartRoutingLlmClient(logger, {
      tiers: [
        { label: "openai:gpt-5.4-mini", client: mini },
        { label: "openai:gpt-5.4", client: advanced },
        { label: "ollama:qwen3:1.7b", client: ollama },
      ],
      advancedIndex: 1,
      routing: {
        enabled: true,
        complexityPromptChars: 180,
        toolComplexityPromptChars: 80,
        useAdvancedForTools: true,
      },
    });
    const result = await client.chat({
      messages: [{ role: "user", content: "oi atlas" }],
    });
    results.push({
      name: "smart_routing_keeps_simple_prompt_on_mini",
      passed: result.message.content === "mini" && mini.chatCalls === 1 && advanced.chatCalls === 0 && ollama.chatCalls === 0,
    });
  }

  {
    const logger = new MemoryLogger();
    const mini = new FakeLlmClient(response("mini", "gpt-5.4-mini"));
    const advanced = new FakeLlmClient(response("advanced", "gpt-5.4"));
    const ollama = new FakeLlmClient(response("ollama", "qwen3:1.7b"));
    const client = new SmartRoutingLlmClient(logger, {
      tiers: [
        { label: "openai:gpt-5.4-mini", client: mini },
        { label: "openai:gpt-5.4", client: advanced },
        { label: "ollama:qwen3:1.7b", client: ollama },
      ],
      advancedIndex: 1,
      routing: {
        enabled: true,
        complexityPromptChars: 180,
        toolComplexityPromptChars: 80,
        useAdvancedForTools: true,
      },
    });
    const result = await client.chat({
      messages: [{ role: "user", content: "Quanto vou gastar de Porto Alegre até Torres com gasolina 6,19 e 11 km/l?" }],
      tools: [
        {
          type: "function",
          function: {
            name: "maps_route",
            description: "route",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
    results.push({
      name: "smart_routing_sends_complex_tool_prompt_to_advanced",
      passed: result.message.content === "advanced" && mini.chatCalls === 0 && advanced.chatCalls === 1 && ollama.chatCalls === 0,
    });
  }

  {
    const logger = new MemoryLogger();
    const mini = new FakeLlmClient(response("mini", "gpt-5.4-mini"));
    const advanced = new FakeLlmClient(new Error("openai advanced offline"));
    const ollama = new FakeLlmClient(response("ollama", "qwen3:1.7b"));
    const client = new SmartRoutingLlmClient(logger, {
      tiers: [
        { label: "openai:gpt-5.4-mini", client: mini },
        { label: "openai:gpt-5.4", client: advanced },
        { label: "ollama:qwen3:1.7b", client: ollama },
      ],
      advancedIndex: 1,
      routing: {
        enabled: true,
        complexityPromptChars: 180,
        toolComplexityPromptChars: 80,
        useAdvancedForTools: true,
      },
    });
    const result = await client.chat({
      messages: [{ role: "user", content: "Compare duas alternativas de rota e custo para amanhã cedo." }],
      tools: [
        {
          type: "function",
          function: {
            name: "maps_route",
            description: "route",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
    results.push({
      name: "smart_routing_falls_back_to_ollama_after_openai_failure",
      passed: result.message.content === "ollama" && mini.chatCalls === 0 && advanced.chatCalls === 1 && ollama.chatCalls === 1,
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
