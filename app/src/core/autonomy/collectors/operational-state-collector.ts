import { randomUUID } from "node:crypto";
import type { AutonomyCollector, AutonomyCollectorInput, AutonomyObservation } from "../../../types/autonomy.js";
import type { OperationalState, OperationalStateSignal } from "../../../types/operational-state.js";

interface OperationalStateReader {
  getOperationalState(): OperationalState;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildSignalTrust(signal: OperationalStateSignal): AutonomyObservation["sourceTrust"] {
  switch (signal.source) {
    case "calendar":
    case "tasks":
    case "focus":
    case "mode":
      return "owned_account";
    case "monitored_whatsapp":
      return "external_contact";
    case "pending_alert":
    case "context":
    default:
      return "owned_account";
  }
}

function toObservation(signal: OperationalStateSignal, now: string): AutonomyObservation | undefined {
  const normalizedSummary = normalize(signal.summary);
  if (signal.kind === "reply_needed") {
    return {
      id: randomUUID(),
      fingerprint: `pending_reply:${signal.key}`,
      kind: "pending_reply",
      sourceKind: signal.source === "monitored_whatsapp" ? "whatsapp" : "system",
      sourceId: signal.key,
      sourceTrust: buildSignalTrust(signal),
      title: `Resposta pendente: ${signal.summary}`,
      summary: signal.summary,
      evidence: [`signal:${signal.kind}`, `priority:${signal.priority}`, `source:${signal.source}`],
      observedAt: now,
    };
  }

  if (signal.kind === "possible_event" && /conflit|sobrepos|duplicidade|agenda/.test(normalizedSummary)) {
    return {
      id: randomUUID(),
      fingerprint: `calendar_conflict:${signal.key}`,
      kind: "calendar_conflict",
      sourceKind: signal.source === "calendar" ? "calendar" : "system",
      sourceId: signal.key,
      sourceTrust: buildSignalTrust(signal),
      title: `Possível conflito de agenda: ${signal.summary}`,
      summary: signal.summary,
      evidence: [`signal:${signal.kind}`, `priority:${signal.priority}`, `source:${signal.source}`],
      observedAt: now,
    };
  }

  if (signal.kind === "deadline") {
    return {
      id: randomUUID(),
      fingerprint: `goal_at_risk:${signal.key}`,
      kind: "goal_at_risk",
      sourceKind: signal.source === "tasks" ? "tasks" : "system",
      sourceId: signal.key,
      sourceTrust: buildSignalTrust(signal),
      title: `Prazo em risco: ${signal.summary}`,
      summary: signal.summary,
      evidence: [`signal:${signal.kind}`, `priority:${signal.priority}`, `source:${signal.source}`],
      observedAt: now,
    };
  }

  return undefined;
}

export class OperationalStateCollector implements AutonomyCollector {
  readonly name = "operational-state";

  constructor(private readonly personalMemory: OperationalStateReader) {}

  collect(input: AutonomyCollectorInput): AutonomyObservation[] {
    const state = this.personalMemory.getOperationalState();
    const observations: AutonomyObservation[] = [];

    if (state.pendingApprovals > 0) {
      observations.push({
        id: randomUUID(),
        fingerprint: "approval_waiting:operational_state",
        kind: "approval_waiting",
        sourceKind: "system",
        sourceTrust: "owned_account",
        title: `${state.pendingApprovals} aprovação(ões) pendente(s)`,
        summary: `O estado operacional mostra ${state.pendingApprovals} aprovação(ões) aguardando decisão.`,
        evidence: [`pending_approvals:${state.pendingApprovals}`],
        observedAt: input.now,
      });
    }

    if (state.primaryRisk) {
      const normalizedRisk = normalize(state.primaryRisk);
      if (/prazo|venc|atras|deadline|risco/.test(normalizedRisk)) {
        observations.push({
          id: randomUUID(),
          fingerprint: `goal_at_risk:primary_risk:${normalizedRisk}`,
          kind: "goal_at_risk",
          sourceKind: "system",
          sourceTrust: "owned_account",
          title: `Risco operacional: ${state.primaryRisk}`,
          summary: state.primaryRisk,
          evidence: ["source:operational_state.primaryRisk"],
          observedAt: input.now,
        });
      }
    }

    for (const signal of state.signals.filter((item) => item.active)) {
      const observation = toObservation(signal, input.now);
      if (observation) {
        observations.push(observation);
      }
    }

    return observations;
  }
}
