import type { TurnAudience, TurnTimeRange } from "../../types/turn-frame.js";

export function normalizeTurnText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function includesAnyTurnToken(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function extractTurnAudience(normalized: string): TurnAudience | undefined {
  if (includesAnyTurnToken(normalized, ["minha equipe", "da equipe", "para equipe", "pro time", "para o time", "coordenação", "coordenacao"])) {
    return "team";
  }
  if (includesAnyTurnToken(normalized, ["cliente", "externo", "externa", "para fora"])) {
    return "external";
  }
  if (includesAnyTurnToken(normalized, ["pra mim", "para mim", "só meu", "so meu", "so para mim", "só para mim"])) {
    return "self";
  }
  return undefined;
}

export function extractProviderEntity(normalized: string): "google" | undefined {
  if (normalized.includes("google")) {
    return "google";
  }
  return undefined;
}

export function extractDestinationLabel(normalized: string): string | undefined {
  const match = normalized.match(/(?:grupo|destino|equipe|canal)\s+([a-z0-9_\- ]{3,})$/i);
  return match?.[1]?.trim() || undefined;
}

export function extractTimeRange(normalized: string): TurnTimeRange | undefined {
  const rangeMatch = normalized.match(/\b(?:das?|de)\s+(\d{1,2})(?::?(\d{2}))?\s*h?\s*(?:as|a)\s*(\d{1,2})(?::?(\d{2}))?\s*h?\b/i);
  if (rangeMatch) {
    const [, startHour, startMinute, endHour, endMinute] = rangeMatch;
    return {
      start: `${startHour.padStart(2, "0")}:${(startMinute ?? "00").padStart(2, "0")}`,
      end: `${endHour.padStart(2, "0")}:${(endMinute ?? "00").padStart(2, "0")}`,
      reference: extractTimeReference(normalized),
    };
  }

  const singleMatch = normalized.match(/\b(?:as|a partir das|para)\s+(\d{1,2})(?::?(\d{2}))?\s*h?\b/i);
  if (singleMatch) {
    const [, startHour, startMinute] = singleMatch;
    return {
      start: `${startHour.padStart(2, "0")}:${(startMinute ?? "00").padStart(2, "0")}`,
      reference: extractTimeReference(normalized),
    };
  }

  const reference = extractTimeReference(normalized);
  return reference && reference !== "unknown"
    ? { reference }
    : undefined;
}

function extractTimeReference(normalized: string): TurnTimeRange["reference"] {
  if (normalized.includes("proxima terca") || normalized.includes("próxima terça") || normalized.includes("na proxima semana") || normalized.includes("na próxima semana")) {
    return "next_week";
  }
  if (normalized.includes("amanha") || normalized.includes("amanhã")) {
    return "tomorrow";
  }
  if (normalized.includes("hoje")) {
    return "today";
  }
  if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(normalized)) {
    return "explicit_date";
  }
  return "unknown";
}
