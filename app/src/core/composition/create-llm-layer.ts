import type { AppConfig, LlmProviderConfig } from "../../types/config.js";
import type { LlmClient } from "../../types/llm.js";
import type { Logger } from "../../types/logger.js";
import { FallbackLlmClient } from "../fallback-llm-client.js";
import { OllamaClient } from "../ollama-client.js";
import { OpenAIClient } from "../openai-client.js";
import { SmartRoutingLlmClient } from "../smart-routing-llm-client.js";
import type { LlmLayer } from "./types.js";

function withLlmProviderConfig(config: AppConfig, providerConfig: LlmProviderConfig): AppConfig {
  return {
    ...config,
    llm: {
      ...config.llm,
      provider: providerConfig.provider,
      baseUrl: providerConfig.baseUrl,
      model: providerConfig.model,
      timeoutMs: providerConfig.timeoutMs,
      apiKey: providerConfig.apiKey,
    },
  };
}

function createSingleLlmClient(
  config: AppConfig,
  logger: Logger,
  providerConfig: LlmProviderConfig,
): LlmClient {
  const scopedConfig = withLlmProviderConfig(config, providerConfig);
  return providerConfig.provider === "openai"
    ? new OpenAIClient(scopedConfig, logger.child({ scope: "openai" }))
    : new OllamaClient(scopedConfig, logger.child({ scope: "ollama" }));
}

function createConfiguredLlmClient(config: AppConfig, logger: Logger): LlmClient {
  const openAiMini = config.llm.openai
    ? createSingleLlmClient(config, logger, config.llm.openai)
    : undefined;
  const openAiAdvanced = config.llm.advanced
    ? createSingleLlmClient(config, logger, config.llm.advanced)
    : undefined;
  const ollamaFallback = config.llm.ollama
    ? createSingleLlmClient(config, logger, config.llm.ollama)
    : undefined;
  const advancedProviderConfig = config.llm.advanced;

  if (
    config.llm.smartRouting?.enabled
    && openAiMini
    && openAiAdvanced
    && advancedProviderConfig
    && config.llm.openai?.model !== advancedProviderConfig.model
  ) {
    const tiers = [
      {
        label: `${config.llm.openai?.provider ?? "openai"}:${config.llm.openai?.model ?? config.llm.model}`,
        client: openAiMini,
      },
      {
        label: `${advancedProviderConfig.provider}:${advancedProviderConfig.model}`,
        client: openAiAdvanced,
      },
      ...(ollamaFallback
        ? [{
            label: `${config.llm.ollama?.provider ?? "ollama"}:${config.llm.ollama?.model ?? "unknown"}`,
            client: ollamaFallback,
          }]
        : []),
    ];

    return new SmartRoutingLlmClient(
      logger.child({ scope: "llm-smart-routing" }),
      {
        tiers,
        advancedIndex: 1,
        routing: config.llm.smartRouting,
      },
    );
  }

  if (config.llm.provider === "fallback" && config.llm.fallback) {
    const primary = createSingleLlmClient(config, logger, config.llm.fallback.primary);
    const secondary = createSingleLlmClient(config, logger, config.llm.fallback.secondary);
    return new FallbackLlmClient(
      primary,
      secondary,
      logger.child({ scope: "llm-fallback" }),
      {
        primaryLabel: `${config.llm.fallback.primary.provider}:${config.llm.fallback.primary.model}`,
        secondaryLabel: `${config.llm.fallback.secondary.provider}:${config.llm.fallback.secondary.model}`,
      },
    );
  }

  const singleProvider = config.llm.provider === "openai"
    ? config.llm.openai ?? {
        provider: "openai" as const,
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        timeoutMs: config.llm.timeoutMs,
        apiKey: config.llm.apiKey,
      }
    : config.llm.ollama ?? {
        provider: "ollama" as const,
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        timeoutMs: config.llm.timeoutMs,
      };
  return createSingleLlmClient(config, logger, singleProvider);
}

export function createLlmLayer(config: AppConfig, logger: Logger): LlmLayer {
  return {
    client: createConfiguredLlmClient(config, logger),
  };
}
