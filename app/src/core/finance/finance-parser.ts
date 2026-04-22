import type { CreateFinanceEntryInput } from "../../types/finance-entry.js";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(prompt: string): number | undefined {
  const match = prompt.match(/(?:r\$\s*)?(\d+(?:[.,]\d{1,2})?)/i);
  if (!match?.[1]) {
    return undefined;
  }
  const amount = Number(match[1].replace(".", "").replace(",", "."));
  return Number.isFinite(amount) ? amount : undefined;
}

function parseDueAt(prompt: string, now = new Date()): string | undefined {
  const normalized = normalize(prompt);
  if (normalized.includes("amanha")) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(12, 0, 0, 0);
    return date.toISOString();
  }
  const iso = prompt.match(/(20\d{2}-\d{2}-\d{2})/);
  if (iso?.[1]) {
    return `${iso[1]}T12:00:00.000Z`;
  }
  const br = prompt.match(/(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}))?/);
  if (br?.[1] && br[2]) {
    const year = br[3] ? Number(br[3]) : now.getFullYear();
    const month = Number(br[2]) - 1;
    const day = Number(br[1]);
    const date = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  return undefined;
}

function inferCategory(prompt: string): string | undefined {
  const normalized = normalize(prompt);
  if (normalized.includes("combust")) return "combustível";
  if (normalized.includes("aluguel")) return "moradia";
  if (normalized.includes("agua") || normalized.includes("luz") || normalized.includes("internet")) return "contas";
  if (normalized.includes("mercado") || normalized.includes("supermercado")) return "alimentação";
  return undefined;
}

function inferTitle(prompt: string): string {
  const cleaned = prompt
    .replace(/registre|anote|lance|minha|minhas|um|uma|de|no|na/gi, " ")
    .replace(/r\$\s*\d+(?:[.,]\d{1,2})?/gi, " ")
    .replace(/\d{1,2}\/\d{1,2}(?:\/20\d{2})?|20\d{2}-\d{2}-\d{2}/g, " ")
    .replace(/amanh[aã]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "lançamento financeiro";
}

export class FinanceParser {
  parseEntry(prompt: string, now = new Date()): CreateFinanceEntryInput | undefined {
    const normalized = normalize(prompt);
    if (!["despesa", "gasto", "conta", "boleto", "recebi", "entrada", "ganhei"].some((token) => normalized.includes(token))) {
      return undefined;
    }
    const amount = parseAmount(prompt);
    if (!amount) {
      return undefined;
    }
    const kind = normalized.includes("recebi") || normalized.includes("entrada") || normalized.includes("ganhei")
      ? "income"
      : normalized.includes("conta") || normalized.includes("boleto")
        ? "bill"
        : "expense";
    return {
      title: inferTitle(prompt),
      amount,
      kind,
      status: kind === "income" ? "paid" : normalized.includes("vence") || normalized.includes("venc") ? "due" : "planned",
      dueAt: parseDueAt(prompt, now),
      category: inferCategory(prompt),
      sourceKind: "manual",
    };
  }
}
