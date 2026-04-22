import process from "node:process";
import type { ExternalReasoningConfig } from "../src/types/config.js";
import { shouldAttemptExternalReasoning } from "../src/core/external-reasoning-policy.js";
import { shouldBypassPreLocalExternalReasoningForPrompt } from "../src/core/agent-core.js";
import type { IntentResolution } from "../src/core/intent-router.js";
import type { OrchestrationContext } from "../src/types/orchestration.js";

interface EvalResult {
  name: string;
  passed: boolean;
  detail?: string;
}

function buildOrchestration(overrides?: {
  route?: Partial<OrchestrationContext["route"]>;
  policy?: Partial<OrchestrationContext["policy"]>;
}): OrchestrationContext {
  return {
    route: {
      primaryDomain: "secretario_operacional",
      secondaryDomains: [],
      confidence: 0.81,
      actionMode: "plan",
      reasons: ["eval"],
      ...overrides?.route,
    },
    policy: {
      riskLevel: "medium",
      autonomyLevel: "draft_with_confirmation",
      guardrails: [],
      requiresApprovalFor: [],
      capabilities: {
        canReadSensitiveChannels: true,
        canDraftExternalReplies: true,
        canSendExternalReplies: false,
        canWriteWorkspace: false,
        canPersistMemory: true,
        canRunProjectTools: false,
        canModifyCalendar: false,
        canPublishContent: false,
      },
      ...overrides?.policy,
    },
  };
}

function buildIntent(input?: Partial<IntentResolution>): IntentResolution {
  return {
    rawPrompt: input?.rawPrompt ?? "Mensagem atual do usuário: organize meu dia",
    activeUserPrompt: input?.activeUserPrompt ?? "organize meu dia",
    historyUserTurns: input?.historyUserTurns ?? [],
    mentionedDomains: input?.mentionedDomains ?? ["secretario_operacional"],
    compoundIntent: input?.compoundIntent ?? false,
    orchestration: input?.orchestration ?? buildOrchestration(),
  };
}

function buildConfig(overrides?: Partial<ExternalReasoningConfig>): ExternalReasoningConfig {
  return {
    mode: "smart",
    enabled: true,
    baseUrl: "https://reasoning.example.com",
    timeoutMs: 1000,
    routeSimpleReads: false,
    ...overrides,
  };
}

function run() {
  const results: EvalResult[] = [];

  results.push({
    name: "always_mode_attempts_provider_before_local_routes",
    passed: shouldAttemptExternalReasoning(
      buildConfig({ mode: "always", enabled: true }),
      "qual minha agenda para amanhã?",
      buildIntent({
        activeUserPrompt: "qual minha agenda para amanhã?",
        orchestration: buildOrchestration({
          route: {
            actionMode: "schedule",
            confidence: 0.93,
          },
          policy: {
            riskLevel: "low",
            autonomyLevel: "autonomous_low_risk",
          },
        }),
      }),
      "pre_local",
    ),
  });

  results.push({
    name: "pre_local_bypass_keeps_weather_shortcuts_local",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "clima hoje",
      buildIntent({
        activeUserPrompt: "clima hoje",
        orchestration: buildOrchestration({
          route: {
            actionMode: "analyze",
            confidence: 0.88,
          },
          policy: {
            riskLevel: "low",
            autonomyLevel: "autonomous_low_risk",
          },
        }),
      }),
    ),
  });

  results.push({
    name: "pre_local_bypass_keeps_briefing_local",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "briefing da manhã",
      buildIntent({
        activeUserPrompt: "briefing da manhã",
        orchestration: buildOrchestration({
          route: {
            actionMode: "brief",
            confidence: 0.91,
          },
          policy: {
            riskLevel: "low",
            autonomyLevel: "autonomous_low_risk",
          },
        }),
      }),
    ),
  });

  results.push({
    name: "pre_local_bypass_keeps_briefing_schedule_update_local",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "mude o briefing da manhã para 6h",
      buildIntent({
        activeUserPrompt: "mude o briefing da manhã para 6h",
        orchestration: buildOrchestration({
          route: {
            actionMode: "communicate",
            confidence: 0.9,
          },
          policy: {
            riskLevel: "low",
            autonomyLevel: "autonomous_low_risk",
          },
        }),
      }),
    ),
  });

  results.push({
    name: "pre_local_bypass_keeps_greeting_local",
    passed: shouldBypassPreLocalExternalReasoningForPrompt(
      "oi atlas",
      buildIntent({
        activeUserPrompt: "oi atlas",
      }),
    ),
  });

  results.push({
    name: "always_mode_does_not_retry_provider_after_direct_routes",
    passed: !shouldAttemptExternalReasoning(
      buildConfig({ mode: "always", enabled: true }),
      "qual minha agenda para amanhã?",
      buildIntent({
        activeUserPrompt: "qual minha agenda para amanhã?",
        orchestration: buildOrchestration({
          route: {
            actionMode: "schedule",
            confidence: 0.93,
          },
          policy: {
            riskLevel: "low",
            autonomyLevel: "autonomous_low_risk",
          },
        }),
      }),
      "post_direct_routes",
    ),
  });

  results.push({
    name: "off_mode_never_attempts_provider",
    passed: !shouldAttemptExternalReasoning(
      buildConfig({ mode: "off", enabled: false }),
      "organize meu dia",
      buildIntent(),
      "pre_local",
    ),
  });

  results.push({
    name: "smart_mode_keeps_low_friction_reads_local_by_default",
    passed: !shouldAttemptExternalReasoning(
      buildConfig({ mode: "smart", routeSimpleReads: false }),
      "qual minha agenda para amanhã?",
      buildIntent({
        activeUserPrompt: "qual minha agenda para amanhã?",
        orchestration: buildOrchestration({
          route: {
            actionMode: "schedule",
            confidence: 0.91,
          },
          policy: {
            riskLevel: "low",
            autonomyLevel: "autonomous_low_risk",
          },
        }),
      }),
      "post_direct_routes",
    ),
  });

  results.push({
    name: "smart_mode_preserves_current_complex_prompt_policy",
    passed: shouldAttemptExternalReasoning(
      buildConfig({ mode: "smart" }),
      "analise e priorize meu dia com foco estratégico",
      buildIntent({
        activeUserPrompt: "analise e priorize meu dia com foco estratégico",
        orchestration: buildOrchestration({
          route: {
            actionMode: "plan",
            confidence: 0.82,
          },
        }),
      }),
      "post_direct_routes",
    ),
  });

  results.push({
    name: "smart_mode_keeps_existing_simple_read_policy_even_when_route_simple_reads_enabled",
    passed: !shouldAttemptExternalReasoning(
      buildConfig({ mode: "smart", routeSimpleReads: true }),
      "qual minha agenda para amanhã?",
      buildIntent({
        activeUserPrompt: "qual minha agenda para amanhã?",
        orchestration: buildOrchestration({
          route: {
            actionMode: "schedule",
            confidence: 0.91,
          },
          policy: {
            riskLevel: "low",
            autonomyLevel: "autonomous_low_risk",
          },
        }),
      }),
      "post_direct_routes",
    ),
  });

  results.push({
    name: "missing_base_url_disables_even_always_mode",
    passed: !shouldAttemptExternalReasoning(
      buildConfig({ mode: "always", baseUrl: undefined, enabled: false }),
      "organize meu dia",
      buildIntent(),
      "pre_local",
    ),
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

  console.log(`\nExternal reasoning mode evals ok: ${results.length}/${results.length}`);
}

run();
