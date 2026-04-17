import type { ApprovalInboxItemRecord } from "../types/approval-inbox.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hoursSince(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.round((Date.now() - parsed) / (60 * 60 * 1000)));
}

function baseActionScore(actionKind: string): number {
  switch (actionKind) {
    case "monitored_channel_alert":
      return 88;
    case "whatsapp_reply":
      return 92;
    case "google_event":
    case "google_event_update":
    case "google_event_delete":
    case "google_event_delete_batch":
      return 84;
    case "google_event_import_batch":
      return 80;
    case "email_reply":
      return 78;
    case "google_task":
      return 72;
    case "youtube_publish":
      return 58;
    default:
      return 50;
  }
}

function subjectBoost(subject: string): number {
  const normalized = normalize(subject);
  let score = 0;
  if (/(paulo|agenda|compromisso|evento|calendario|calendário|reuniao|reunião)/.test(normalized)) {
    score += 16;
  }
  if (/(cliente|whatsapp|resposta|responder|suporte|ticket|atendimento)/.test(normalized)) {
    score += 12;
  }
  if (/(monitorado|monitorada|monitoramento|institucional)/.test(normalized)) {
    score += 10;
  }
  if (/(importacao de agenda|importação de agenda|23 evento|lote|batch)/.test(normalized)) {
    score += 10;
  }
  if (/(youtube|video|vídeo|publish)/.test(normalized)) {
    score -= 4;
  }
  return score;
}

function ageBoost(createdAt: string): number {
  const ageHours = hoursSince(createdAt);
  if (ageHours >= 72) {
    return 14;
  }
  if (ageHours >= 24) {
    return 10;
  }
  if (ageHours >= 8) {
    return 6;
  }
  if (ageHours >= 2) {
    return 3;
  }
  return 0;
}

function buildReason(item: ApprovalInboxItemRecord): string {
  const normalized = normalize(item.subject);
  if (item.actionKind === "whatsapp_reply") {
    return "destrava resposta pendente";
  }
  if (item.actionKind === "monitored_channel_alert") {
    return "sinal relevante em canal monitorado";
  }
  if (item.actionKind === "google_event_import_batch") {
    return "altera vários eventos de uma vez";
  }
  if (/(paulo|agenda|compromisso|evento|calendario|calendário)/.test(normalized)) {
    return "impacta agenda e rotina";
  }
  if (item.actionKind === "youtube_publish") {
    return "libera publicação";
  }
  return "pendência operacional";
}

export interface RankedApproval {
  item: ApprovalInboxItemRecord;
  score: number;
  urgency: "alta" | "media" | "baixa";
  reason: string;
  ageHours: number;
}

export function rankApprovals(items: ApprovalInboxItemRecord[]): RankedApproval[] {
  return [...items]
    .map((item) => {
      const score = baseActionScore(item.actionKind) + subjectBoost(item.subject) + ageBoost(item.createdAt);
      const ageHours = hoursSince(item.createdAt);
      const urgency: RankedApproval["urgency"] = score >= 95 ? "alta" : score >= 72 ? "media" : "baixa";
      return {
        item,
        score,
        urgency,
        reason: buildReason(item),
        ageHours,
      };
    })
    .sort((left, right) => right.score - left.score || left.item.createdAt.localeCompare(right.item.createdAt));
}
