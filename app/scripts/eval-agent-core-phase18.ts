import process from "node:process";
import { AgentDirectRouteService } from "../src/core/agent-direct-route-service.js";
import {
  DirectRouteRunner,
  type DirectRouteExecutionInput,
} from "../src/core/direct-route-runner.js";
import type { Logger } from "../src/types/logger.js";

type EvalResult = {
  name: string;
  passed: boolean;
  detail?: string;
};

function assert(name: string, passed: boolean, detail?: string): EvalResult {
  return { name, passed, detail };
}

function makeLogger(): Logger {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    child: () => logger,
  } as unknown as Logger;
  return logger;
}

function makeInput(prompt: string): DirectRouteExecutionInput {
  return {
    userPrompt: prompt,
    activeUserPrompt: prompt,
    requestId: `req-${prompt}`,
    requestLogger: makeLogger(),
    intent: {
      rawPrompt: prompt,
      activeUserPrompt: prompt,
      mentionedDomains: [],
      compoundIntent: false,
      historyUserTurns: [],
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          actionMode: "answer",
          confidence: 0.8,
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "assist",
        },
      },
    },
    orchestration: {
      route: {
        primaryDomain: "secretario_operacional",
        secondaryDomains: [],
        actionMode: "answer",
        confidence: 0.8,
      },
      policy: {
        riskLevel: "low",
        autonomyLevel: "assist",
      },
    },
    preferences: {
      responseStyle: "concise",
      responseLength: "short",
      proactiveNextStep: false,
      preferredAgentName: "Atlas",
    },
    options: {
      chatId: "chat-1",
    },
  };
}

async function run(): Promise<void> {
  const noop = async () => null;
  const results: EvalResult[] = [];
  const fallbackCalls: string[] = [];
  const greetingCalls: string[] = [];
  const workflowCalls: string[] = [];

  const service = new AgentDirectRouteService(
    new DirectRouteRunner(makeLogger()),
    {
      conversation: {
        ping: async () => null,
        greeting: async (input) => {
          if (input.activeUserPrompt !== "oi atlas") {
            return null;
          }
          greetingCalls.push(input.activeUserPrompt);
          return {
            requestId: input.requestId,
            reply: "saudação resolvida",
            messages: [],
            toolExecutions: [],
          };
        },
        conversationStyleCorrection: noop,
        agentIdentity: noop,
      },
      capability: {
        personalProfileShow: noop,
        operationalStateShow: noop,
        learnedPreferencesList: noop,
        learnedPreferencesDelete: noop,
        capabilityInspection: noop,
        activeGoal: noop,
        capabilityPlanning: noop,
      },
      memoryAndPreference: {
        personalProfileUpdate: noop,
        personalProfileDelete: noop,
        userPreferences: noop,
        personalMemoryList: noop,
        personalMemorySave: noop,
        personalMemoryUpdate: noop,
        personalMemoryDelete: noop,
      },
      operational: {
        morningBrief: noop,
        operationalPlanning: noop,
        macQueueStatus: noop,
        macQueueList: noop,
        macQueueEnqueue: noop,
        contactList: noop,
        contactUpsert: noop,
        memoryEntityList: noop,
        memoryEntitySearch: noop,
        intentResolve: noop,
      },
      workflow: {
        workflowList: noop,
        workflowShow: noop,
        workflowArtifacts: noop,
        workflowExecution: async (input) => {
          if (input.activeUserPrompt !== "execute workflow") {
            return null;
          }
          workflowCalls.push(input.activeUserPrompt);
          return {
            requestId: input.requestId,
            reply: "workflow resolvido",
            messages: [],
            toolExecutions: [],
          };
        },
        workflowStepUpdate: noop,
        workflowPlanning: noop,
      },
      review: {
        memoryUpdateGuard: noop,
        supportReview: noop,
        followUpReview: noop,
        inboxTriage: noop,
        operationalBrief: noop,
        nextCommitmentPrep: noop,
      },
      googleWorkspace: {
        calendarLookup: noop,
        calendarConflictReview: noop,
        calendarPeriodList: noop,
        googleTaskDraft: noop,
        googleEventDraft: noop,
        googleEventMove: noop,
        googleEventDelete: noop,
        googleTasks: noop,
        googleContacts: noop,
        googleCalendarsList: noop,
        placeLookup: noop,
      },
      messaging: {
        whatsappSend: noop,
        whatsappRecentSearch: noop,
        whatsappPendingApprovals: noop,
      },
      knowledgeAndProject: {
        weather: noop,
        internalKnowledgeLookup: noop,
        webResearch: noop,
        revenueScoreboard: noop,
        allowedSpaces: noop,
        projectScan: noop,
        projectMirror: noop,
        safeExec: noop,
      },
      content: {
        dailyEditorialResearch: noop,
        contentIdeaGeneration: noop,
        contentReview: noop,
        contentScriptGeneration: noop,
        contentBatchPlanning: noop,
        contentBatchGeneration: noop,
        contentDistributionStrategy: noop,
        contentChannels: noop,
        contentSeries: noop,
        contentFormatLibrary: noop,
        contentHookLibrary: noop,
        contentOverview: noop,
        caseNotes: noop,
      },
      email: {
        emailDraft: noop,
        emailSummary: noop,
        emailLookup: noop,
      },
    },
    async (input) => {
      fallbackCalls.push(input.activeUserPrompt);
      return {
        requestId: input.requestId,
        reply: "fallback externo",
        messages: [],
        toolExecutions: [],
      };
    },
  );

  {
    const output = await service.run(makeInput("oi atlas"));
    results.push(assert(
      "agent_direct_route_service_resolves_first_matching_group",
      output?.reply === "saudação resolvida" && greetingCalls.length === 1,
      JSON.stringify({ output, greetingCalls }),
    ));
  }

  {
    const output = await service.run(makeInput("execute workflow"));
    results.push(assert(
      "agent_direct_route_service_reaches_later_groups_without_rebuilding_contract",
      output?.reply === "workflow resolvido" && workflowCalls.length === 1,
      JSON.stringify({ output, workflowCalls }),
    ));
  }

  {
    const output = await service.run(makeInput("nada casa"));
    results.push(assert(
      "agent_direct_route_service_invokes_fallback_when_no_route_matches",
      output?.reply === "fallback externo" && fallbackCalls.length === 1,
      JSON.stringify({ output, fallbackCalls }),
    ));
  }

  {
    const routeKeys = ((service as unknown as { routeDefinitions?: Array<{ key: string }> }).routeDefinitions ?? [])
      .slice(0, 5)
      .map((item) => item.key);
    results.push(assert(
      "agent_direct_route_service_caches_registry_in_declared_order",
      routeKeys.join(",") === [
        "ping",
        "greeting",
        "conversation_style_correction",
        "agent_identity",
        "personal_profile_show",
      ].join(","),
      JSON.stringify(routeKeys),
    ));
  }

  const failed = results.filter((item) => !item.passed);
  for (const result of results) {
    const prefix = result.passed ? "PASS" : "FAIL";
    const suffix = result.detail ? ` :: ${result.detail}` : "";
    console.log(`${prefix} ${result.name}${suffix}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error("eval-agent-core-phase18 failed", error);
  process.exitCode = 1;
});
