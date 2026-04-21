import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { strict as assert } from "node:assert";
import { CommitmentExtractor } from "../src/core/autonomy/commitment-extractor.js";
import { CommitmentStore } from "../src/core/autonomy/commitment-store.js";
import { CommitmentCollector } from "../src/core/autonomy/collectors/commitment-collector.js";
import { RequestOrchestrator } from "../src/core/request-orchestrator.js";
import { AssistantActionDispatcher } from "../src/core/action-dispatcher.js";
import { ObservationStore } from "../src/core/autonomy/observation-store.js";
import { SuggestionStore } from "../src/core/autonomy/suggestion-store.js";
import { AutonomyAuditStore } from "../src/core/autonomy/autonomy-audit-store.js";
import { FeedbackStore } from "../src/core/autonomy/feedback-store.js";
import { AutonomyActionService } from "../src/core/autonomy/autonomy-action-service.js";
import { AutonomyDirectService } from "../src/core/autonomy/autonomy-direct-service.js";
import { WhatsAppMonitorService } from "../src/integrations/whatsapp/whatsapp-monitor-service.js";
import { PersonalOperationalMemoryStore } from "../src/core/personal-operational-memory.js";
import type { Logger } from "../src/types/logger.js";

const logger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

function createWorkspace(): string {
  return mkdtempSync(path.join(tmpdir(), "atlas-commitments-"));
}

function makeCapabilityRegistry() {
  return {
    getCapability: () => null,
  };
}

async function main(): Promise<void> {
  const workspace = createWorkspace();

  try {
    const dbPath = path.join(workspace, "autonomy.sqlite");
    const commitments = new CommitmentStore(dbPath, logger);
    const extractor = new CommitmentExtractor(logger);

    const directCandidates = extractor.extract({
      text: "Te mando isso amanhã às 9h.",
      sourceKind: "telegram",
      sourceTrust: "operator",
      observedAt: "2026-04-21T12:00:00.000Z",
    });
    assert.equal(directCandidates.length, 1);
    assert.equal(directCandidates[0]!.normalizedAction, "Mandar isso");
    assert.ok(directCandidates[0]!.dueAt);
    const dueAt = new Date(directCandidates[0]!.dueAt!);
    assert.equal(dueAt.getUTCDate(), 22);
    assert.equal(dueAt.getUTCHours(), 12);

    const dispatcher = new AssistantActionDispatcher(
      {
        runUserPrompt: async () => ({
          requestId: "req-1",
          reply: "Tudo certo.",
          toolExecutions: [],
        }),
      } as never,
      logger,
    );
    const orchestrator = new RequestOrchestrator(
      {
        runUserPrompt: async () => ({
          requestId: "req-orchestrated",
          reply: "Anotado por aqui.",
          toolExecutions: [],
        }),
      } as never,
      dispatcher,
      logger,
      {
        extractor,
        store: commitments,
      },
    );

    await orchestrator.run({
      channel: "telegram",
      agentPrompt: "Pode deixar que eu envio a proposta amanhã.",
      recentMessages: [],
      options: { chatId: 123 },
    });
    const storedAfterOrchestrator = commitments.listByStatus(["candidate"], 10);
    assert.ok(storedAfterOrchestrator.some((item) => /Enviar a proposta/i.test(item.normalizedAction)));

    const personalMemory = new PersonalOperationalMemoryStore(path.join(workspace, "personal.sqlite"), logger);
    const approvals = {
      createPending: () => ({ id: 1 }),
      listPending: () => [{ id: 1 }],
    };
    const messages = { saveMessage: () => undefined };
    const contacts = { upsertContact: () => undefined };
    const router = {
      classify: () => ({
        relationship: "externo",
        persona: "operacional",
        priority: "medium",
        actionPolicy: "responder com objetividade",
      }),
    };
    const alerts = { sendToPreferredChannel: async () => undefined };
    const monitor = new WhatsAppMonitorService(
      {
        operator: {
          name: "Paulo",
          operatorId: "paulo",
          channels: [],
        },
        whatsapp: {
          notifyTelegramChatId: 123,
        },
        telegram: {
          allowedUserIds: [123],
        },
        google: {
          calendarId: "primary",
          defaultTimezone: "America/Sao_Paulo",
        },
        googleAccounts: {},
      } as never,
      logger,
      approvals as never,
      contacts as never,
      router as never,
      messages as never,
      personalMemory as never,
      {
        async chat() {
          return { message: { content: "Posso verificar isso e te retorno." } };
        },
      } as never,
      alerts as never,
      {
        extractor,
        store: commitments,
      },
    );

    await monitor.handleInboundText({
      instanceName: "atlas_institucional",
      accountAlias: "abordagem",
      remoteJid: "5511999999999@s.whatsapp.net",
      number: "5511999999999",
      pushName: "Coordenação",
      text: "Pode deixar que eu verifico isso amanhã.",
      createdAt: "2026-04-21T14:00:00.000Z",
    });

    const monitoredCandidate = commitments
      .listByStatus(["candidate"], 20)
      .find((item) => item.sourceId === "5511999999999@s.whatsapp.net");
    assert.ok(monitoredCandidate);
    assert.equal(monitoredCandidate?.sourceTrust, "external_contact");

    const collector = new CommitmentCollector(commitments);
    const observations = collector.collect({ now: "2026-04-21T15:00:00.000Z" });
    const commitmentObservation = observations.find((item) => item.sourceId === monitoredCandidate?.id);
    assert.ok(commitmentObservation);
    assert.equal(commitmentObservation?.kind, "commitment_detected");

    const observationStore = new ObservationStore(dbPath, logger);
    const suggestionStore = new SuggestionStore(dbPath, logger);
    const auditStore = new AutonomyAuditStore(dbPath, logger);
    const feedbackStore = new FeedbackStore(dbPath, logger);
    const persistedObservation = observationStore.upsert(commitmentObservation!);
    const suggestion = suggestionStore.upsert({
      observationId: persistedObservation.id,
      fingerprint: persistedObservation.fingerprint,
      title: persistedObservation.title,
      body: persistedObservation.summary,
      explanation: "Compromisso detectado no fluxo operacional.",
      status: "queued",
      priority: 0.72,
      requiresApproval: false,
    });

    const actionService = new AutonomyActionService({
      logger,
      capabilityRegistry: makeCapabilityRegistry() as never,
      observations: observationStore,
      suggestions: suggestionStore,
      audit: auditStore,
      feedback: feedbackStore,
      commitments,
      executeToolDirect: async () => ({
        requestId: "req-x",
        content: "ok",
        rawResult: { ok: true },
      }),
    });

    const outcome = await actionService.approveSuggestion(suggestion);
    assert.equal(outcome.kind, "approved_only");
    assert.equal(commitments.getById(monitoredCandidate!.id)?.status, "confirmed");

    const autonomyService = new AutonomyDirectService({
      logger,
      loop: { runOnce: async () => ({ observations: [], assessments: [], suggestions: [] }) },
      actionService: {
        approveSuggestion: async () => ({ kind: "approved_only" as const, reply: "ok" }),
      },
      commitments,
      suggestions: suggestionStore,
      observations: observationStore,
      audit: auditStore,
      feedback: feedbackStore,
      buildBaseMessages: () => [],
    });
    const commitmentsReply = await autonomyService.tryRunAutonomyReview({
      userPrompt: "o que eu prometi?",
      requestId: "req-commitments-list",
      orchestration: {
        route: {
          primaryDomain: "secretario_operacional",
          secondaryDomains: [],
          confidence: 0.9,
          actionMode: "communicate",
          reasons: [],
        },
        policy: {
          riskLevel: "low",
          autonomyLevel: "draft_with_confirmation",
          guardrails: [],
          requiresApprovalFor: [],
          capabilities: {
            canReadSensitiveChannels: true,
            canDraftExternalReplies: true,
            canSendExternalReplies: false,
            canWriteWorkspace: true,
            canPersistMemory: true,
            canRunProjectTools: false,
            canModifyCalendar: false,
            canPublishContent: false,
          },
        },
      },
    });
    assert.ok(commitmentsReply);
    assert.match(commitmentsReply!.reply, /compromisso\(s\).*em aberto|compromisso\(s\) teu\(s\)/i);
    assert.match(commitmentsReply!.reply, /Verificar isso/i);

    console.log("eval-commitment-extractor: 6/6 passed");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error("eval-commitment-extractor failed");
  console.error(error);
  process.exitCode = 1;
});
