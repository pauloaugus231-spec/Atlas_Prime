# Decisões Arquiteturais — Atlas Prime

## 2026-04-20 — Fases 1–4: Pipeline de agente decomposto
Extraímos ContextAssembler, ResponseSynthesizer, TurnPlanner, RequestOrchestrator,
ActionDispatcher, ChannelMessageAdapter e DraftActionService do agent-core.ts.
runUserPrompt virou orquestrador de ~40 linhas declarativas.
Motivo: agent-core.ts com 18.552 linhas era impossível de testar e manter.

## 2026-04-20 — Fases 5–6: DirectRouteRunner e famílias por domínio
Criamos dispatcher declarativo e organizamos rotas em:
conversation-personal-routes, operational-direct-routes,
workspace-external-direct-routes, content-email-direct-routes.
Motivo: separar roteamento de execução de lógica de negócio.

## 2026-04-20 — Fase 7: MessagingDirectService
Extraímos handlers de WhatsApp. ~700 linhas saíram do agent-core.ts.
Motivo: isolar domínio de mensageria para teste independente.

## 2026-04-20 — Fases 8–9: GoogleWorkspaceDirectService completo
Todos os handlers de calendário, tarefas, contatos e eventos extraídos.
Inclui calendarConflictReview, googleEventMove e googleEventDelete.
Motivo: fechar o seam de workspace completamente antes de avançar.

## 2026-04-21 — Fases 10–17: Services por domínio (commit 8d1d950)
Extraídos: CapabilityActionService, CapabilityInspectionService,
ExternalIntelligenceDirectService, KnowledgeProjectDirectService,
MemoryContactDirectService, OperationalContextDirectService,
OperationalReviewDirectService, WorkflowDirectService.
agent-core.ts: 18.552 → ~14.355 linhas.
Motivo: cada domínio com responsabilidade única e testável.

## 2026-04-21 — Fases 18–22: Services de conteúdo e registry (commit bfd4180)
Extraídos: ContentDirectService, ContentGenerationDirectService,
EmailDirectService, AgentDirectRouteService, AgentDirectServiceRegistry.
Motivo: registry centralizado de services para composição limpa e extensível.
