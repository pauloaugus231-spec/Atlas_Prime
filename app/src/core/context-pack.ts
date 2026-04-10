import type { Logger } from "../types/logger.js";
import type { IntentResolution } from "./intent-router.js";
import type { ApprovalInboxStore } from "./approval-inbox.js";
import type { ExecutiveMorningBrief, PersonalOSService } from "./personal-os.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export type ContextPackKind =
  | "operational_overview"
  | "approval_review"
  | "intent_inspection";

export interface ContextPack {
  kind: ContextPackKind;
  signals: string[];
  brief?: ExecutiveMorningBrief;
}

function shouldLoadOperationalOverview(prompt: string, intent: IntentResolution): boolean {
  const normalized = normalize(prompt);
  if (intent.orchestration.route.primaryDomain !== "secretario_operacional") {
    return false;
  }

  return includesAny(normalized, [
    "organize meu dia",
    "organizar meu dia",
    "organize minha agenda",
    "organizar minha agenda",
    "priorize meu dia",
    "priorizar meu dia",
    "o que devo focar hoje",
    "o que devo fazer hoje",
    "revisar aprovacoes",
    "revisar aprovações",
  ]);
}

export class ContextPackService {
  constructor(
    private readonly personalOs: PersonalOSService,
    private readonly approvals: ApprovalInboxStore,
    private readonly logger: Logger,
  ) {}

  async buildForPrompt(prompt: string, intent: IntentResolution): Promise<ContextPack | null> {
    if (shouldLoadOperationalOverview(prompt, intent)) {
      const brief = await this.personalOs.getExecutiveMorningBrief();
      const signals: string[] = [
        `${brief.events.length} compromisso(s) hoje`,
        `${brief.taskBuckets.actionableCount} tarefa(s) acionáveis`,
        `${brief.approvals.length} aprovação(ões) pendente(s)`,
      ];

      if (brief.nextAction) {
        signals.push(`próxima ação sugerida: ${brief.nextAction}`);
      }
      if (brief.emails[0]?.subject) {
        signals.push(`email prioritário: ${brief.emails[0].subject}`);
      }

      return {
        kind: "operational_overview",
        brief,
        signals,
      };
    }

    if (includesAny(normalize(prompt), ["aprovacoes", "aprovações", "approval"])) {
      const pending = this.approvals.listPendingAll(6);
      return {
        kind: "approval_review",
        signals: [
          `${pending.length} aprovação(ões) pendente(s)`,
          ...pending.slice(0, 3).map((item) => `${item.actionKind}: ${item.subject}`),
        ],
      };
    }

    if (includesAny(normalize(prompt), ["analise a intencao", "analise a intenção", "mostre a intencao", "inspecione a intencao"])) {
      return {
        kind: "intent_inspection",
        signals: [],
      };
    }

    this.logger.debug("No context pack matched for prompt", {
      primaryDomain: intent.orchestration.route.primaryDomain,
      actionMode: intent.orchestration.route.actionMode,
    });
    return null;
  }
}
