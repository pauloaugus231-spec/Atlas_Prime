import type { CommitmentCandidate } from "../../types/commitments.js";
import type { Logger } from "../../types/logger.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizeSentence(value: string): string {
  const trimmed = value.trim().replace(/[.\s]+$/g, "");
  if (!trimmed) {
    return trimmed;
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function normalizeActionPhrase(value: string): string {
  const cleaned = stripTrailingTimeHints(value);
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "";
  }

  const verbMap: Record<string, string> = {
    aviso: "Avisar",
    envio: "Enviar",
    faco: "Fazer",
    faço: "Fazer",
    mando: "Mandar",
    passo: "Passar",
    resolvo: "Resolver",
    respondo: "Responder",
    retorno: "Retornar com",
    verifico: "Verificar",
    vejo: "Verificar",
  };

  const first = parts.shift()!;
  const mapped = verbMap[normalize(first)] ?? capitalizeSentence(first);
  return [mapped, ...parts].join(" ").trim();
}

function stripTrailingTimeHints(value: string): string {
  return value
    .replace(/\s+(?:amanha|amanhã|hoje|mais tarde|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo).*$/iu, "")
    .replace(/\s+(?:as|às)\s+\d{1,2}(?::\d{2})?\s*h?\b.*$/iu, "")
    .replace(/[.,;:!?]+$/g, "")
    .trim();
}

function parseTimeHint(text: string): { hour: number; minute: number } | undefined {
  const normalized = normalize(text);
  const match = normalized.match(/\b(?:as|às)?\s*(\d{1,2})(?::(\d{2}))?\s*h?\b/u);
  if (!match?.[1]) {
    return undefined;
  }

  return {
    hour: Math.max(0, Math.min(23, Number.parseInt(match[1], 10))),
    minute: match[2] ? Math.max(0, Math.min(59, Number.parseInt(match[2], 10))) : 0,
  };
}

function nextWeekday(base: Date, weekday: number): Date {
  const target = new Date(base);
  const current = target.getDay();
  let delta = (weekday - current + 7) % 7;
  if (delta === 0) {
    delta = 7;
  }
  target.setDate(target.getDate() + delta);
  return target;
}

function resolveDueAt(text: string, nowIso: string): string | undefined {
  const normalized = normalize(text);
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) {
    return undefined;
  }

  const time = parseTimeHint(text) ?? { hour: 18, minute: 0 };
  const target = new Date(now);

  if (normalized.includes("mais tarde")) {
    target.setHours(target.getHours() + 4, 0, 0, 0);
    return target.toISOString();
  }

  const weekdayMap: Array<[RegExp, number]> = [
    [/\bsegunda\b/u, 1],
    [/\bterca\b|\bterça\b/u, 2],
    [/\bquarta\b/u, 3],
    [/\bquinta\b/u, 4],
    [/\bsexta\b/u, 5],
    [/\bsabado\b|\bsábado\b/u, 6],
    [/\bdomingo\b/u, 0],
  ];

  if (normalized.includes("amanha")) {
    target.setDate(target.getDate() + 1);
  } else if (normalized.includes("hoje")) {
    // keep same day
  } else {
    const weekday = weekdayMap.find(([pattern]) => pattern.test(normalized));
    if (!weekday) {
      return undefined;
    }
    const next = nextWeekday(target, weekday[1]);
    target.setFullYear(next.getFullYear(), next.getMonth(), next.getDate());
  }

  target.setHours(time.hour, time.minute, 0, 0);
  return target.toISOString();
}

function dedupe<T>(items: T[], keyBuilder: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyBuilder(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export interface ExtractCommitmentInput {
  text: string;
  sourceKind: CommitmentCandidate["sourceKind"];
  sourceId?: string;
  sourceTrust: CommitmentCandidate["sourceTrust"];
  observedAt?: string;
  counterparty?: string;
}

export class CommitmentExtractor {
  constructor(private readonly logger: Logger) {}

  extract(input: ExtractCommitmentInput): Array<Omit<CommitmentCandidate, "id" | "createdAt" | "updatedAt">> {
    const statement = input.text.trim();
    if (!statement || statement.length < 8) {
      return [];
    }

    const nowIso = input.observedAt ?? new Date().toISOString();
    const normalized = normalize(statement);
    const dueAt = resolveDueAt(statement, nowIso);
    const candidates: Array<Omit<CommitmentCandidate, "id" | "createdAt" | "updatedAt">> = [];

    const pushCandidate = (normalizedAction: string, confidence: number, evidence: string[]) => {
      const cleanedAction = normalizeActionPhrase(normalizedAction);
      if (!cleanedAction) {
        return;
      }

      candidates.push({
        sourceKind: input.sourceKind,
        ...(input.sourceId ? { sourceId: input.sourceId } : {}),
        sourceTrust: input.sourceTrust,
        ...(input.counterparty ? { counterparty: input.counterparty } : {}),
        statement,
        normalizedAction: cleanedAction,
        ...(dueAt ? { dueAt } : {}),
        confidence,
        evidence: [...new Set(evidence.filter(Boolean))].slice(0, 4),
        status: "candidate",
      });
    };

    const meCharge = normalized.match(/\bme\s+cobra\s+(?:na|no|em)?\s*([\wãáàâéêíóôõúç:-]+(?:\s+\d{1,2}h?)?)?/u);
    if (meCharge) {
      pushCandidate(
        "Revisar e concluir o combinado",
        0.88,
        ["Pedido explícito de cobrança futura detectado.", ...(dueAt ? [`Prazo inferido: ${dueAt}`] : [])],
      );
    }

    const canLeaveIt = statement.match(/pode\s+deixar\s+que\s+eu\s+([^.\n!?]+)/iu);
    if (canLeaveIt?.[1]) {
      pushCandidate(
        canLeaveIt[1],
        0.84,
        ["Promessa explícita em primeira pessoa detectada.", ...(dueAt ? [`Prazo inferido: ${dueAt}`] : [])],
      );
    }

    const ficoDe = statement.match(/fico\s+de\s+([^.\n!?]+)/iu);
    if (ficoDe?.[1]) {
      pushCandidate(
        ficoDe[1],
        0.8,
        ["Compromisso verbalizado como 'fico de'.", ...(dueAt ? [`Prazo inferido: ${dueAt}`] : [])],
      );
    }

    const directPromise = statement.match(/(?:te|lhe)\s+(mando|envio|retorno|respondo|aviso|passo)\s+([^.\n!?]+)/iu);
    if (directPromise?.[1]) {
      const verbMap: Record<string, string> = {
        mando: "Mandar",
        envio: "Enviar",
        retorno: "Retornar com",
        respondo: "Responder com",
        aviso: "Avisar",
        passo: "Passar",
      };
      pushCandidate(
        `${verbMap[normalize(directPromise[1])] ?? capitalizeSentence(directPromise[1])} ${directPromise[2]}`,
        0.9,
        ["Promessa direta a outra pessoa detectada.", ...(dueAt ? [`Prazo inferido: ${dueAt}`] : [])],
      );
    }

    const futurePromise = statement.match(/(?:vou|vamos|iremos)\s+(mandar|enviar|retornar|responder|avisar|verificar|resolver|fazer)\s+([^.\n!?]+)/iu);
    if (futurePromise?.[1]) {
      const verbMap: Record<string, string> = {
        mandar: "Mandar",
        enviar: "Enviar",
        retornar: "Retornar com",
        responder: "Responder",
        avisar: "Avisar",
        verificar: "Verificar",
        resolver: "Resolver",
        fazer: "Fazer",
      };
      pushCandidate(
        `${verbMap[normalize(futurePromise[1])] ?? capitalizeSentence(futurePromise[1])} ${futurePromise[2]}`,
        0.78,
        ["Compromisso futuro em primeira pessoa detectado.", ...(dueAt ? [`Prazo inferido: ${dueAt}`] : [])],
      );
    }

    const deduped = dedupe(candidates, (item) => `${normalize(item.normalizedAction)}|${item.dueAt ?? "sem-prazo"}`);
    if (deduped.length > 0) {
      this.logger.debug("Commitment candidates extracted", {
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        count: deduped.length,
      });
    }
    return deduped;
  }
}
