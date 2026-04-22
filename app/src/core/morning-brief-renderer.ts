import type { BriefingProfile } from "../types/briefing-profile.js";
import type { PersonalOperationalProfile } from "../types/personal-operational-memory.js";
import type { ExecutiveMorningBrief } from "./personal-os.js";
import { MorningBriefPolicy } from "./morning-brief-policy.js";

function renderCommitmentLine(item: { timeLabel: string; title: string; note?: string }): string {
  return `- ${item.timeLabel} — ${item.title}${item.note ? ` — ${item.note}` : ""}`;
}

export class MorningBriefRenderer {
  constructor(
    private readonly policy = new MorningBriefPolicy(),
  ) {}

  render(input: {
    brief: ExecutiveMorningBrief;
    profile: BriefingProfile;
    personalProfile?: PersonalOperationalProfile;
    compact?: boolean;
    operationalMode?: "field" | null;
  }): string {
    const plan = this.policy.buildPlan(input);
    const commitmentTitle = plan.variant === "compact" ? "Compromissos" : "Compromissos principais";
    const commitments = plan.commitments.length > 0
      ? plan.commitments.map(renderCommitmentLine)
      : ["- Sem compromisso crítico na agenda até aqui."];

    return [
      `**${plan.greeting}**`,
      plan.dayRead,
      "",
      "**Atenção principal**",
      `- ${plan.attention}`,
      "",
      "**Primeiro movimento**",
      `- ${plan.firstMove}`,
      "",
      `**${commitmentTitle}**`,
      ...commitments,
      "",
      "**Ponto de atenção**",
      `- ${plan.watchpoint}`,
      "",
      `**${plan.closingLabel}**`,
      `- ${plan.closingMessage}`,
    ].join("\n");
  }
}
