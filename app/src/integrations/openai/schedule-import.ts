import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "../../types/logger.js";

interface OpenAIMessage {
  role: "system" | "user";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export type ScheduleImportCategory =
  | "event_importable"
  | "informational"
  | "demand"
  | "holiday"
  | "ambiguous";

interface ScheduleImportEvent {
  date: string;
  startTime: string;
  endTime: string;
  summary: string;
  description?: string;
  location?: string;
  shift?: string;
  confidence?: number;
  category?: ScheduleImportCategory;
  rawText?: string;
  assumedTime?: boolean;
}

export interface ScheduleImportNonEvent {
  summary: string;
  category: Exclude<ScheduleImportCategory, "event_importable">;
  reason?: string;
  date?: string;
  shift?: string;
  rawText?: string;
}

interface ScheduleImportModelResponse {
  events?: ScheduleImportEvent[];
  nonEvents?: ScheduleImportNonEvent[];
  assumptions?: string[];
  uncertainties?: string[];
}

export interface ScheduleImportDraftSeed {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  timezone: string;
  reminderMinutes: number;
  confidence?: number;
  sourceLabel?: string;
  category?: ScheduleImportCategory;
  rawText?: string;
  assumedTime?: boolean;
}

export interface ScheduleImportParseResult {
  events: ScheduleImportDraftSeed[];
  nonEvents: ScheduleImportNonEvent[];
  assumptions: string[];
  uncertainties: string[];
}

function normalizeJsonBlock(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
  }
  return trimmed;
}

function extractJsonObject(value: string): string {
  const normalized = normalizeJsonBlock(value);
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("OpenAI schedule import returned invalid JSON");
  }
  return normalized.slice(firstBrace, lastBrace + 1);
}

function getOffsetString(timeZone: string, year: number, month: number, day: number, hour: number, minute: number): string {
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
  });
  const value = formatter.formatToParts(probe).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = value.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) {
    return "+00:00";
  }
  const sign = match[1];
  const hours = match[2].padStart(2, "0");
  const minutes = (match[3] ?? "00").padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function buildLocalIso(
  timeZone: string,
  date: string,
  time: string,
): string {
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) {
    throw new Error(`Invalid schedule import date/time: ${date} ${time}`);
  }

  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const day = Number.parseInt(dateMatch[3], 10);
  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  const offset = getOffsetString(timeZone, year, month, day, hour, minute);
  return `${date}T${time}:00${offset}`;
}

function normalizeText(value: string | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

function validateDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validateTime(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

function isScheduleImportCategory(value: unknown): value is ScheduleImportCategory {
  return value === "event_importable" ||
    value === "informational" ||
    value === "demand" ||
    value === "holiday" ||
    value === "ambiguous";
}

function sanitizeEvent(event: ScheduleImportEvent, timeZone: string): ScheduleImportDraftSeed | null {
  const summary = normalizeText(event.summary);
  if (!summary || !validateDate(event.date) || !validateTime(event.startTime) || !validateTime(event.endTime)) {
    return null;
  }

  return {
    summary,
    description: normalizeText(event.description),
    location: normalizeText(event.location),
    start: buildLocalIso(timeZone, event.date, event.startTime),
    end: buildLocalIso(timeZone, event.date, event.endTime),
    timezone: timeZone,
    reminderMinutes: 30,
    confidence: typeof event.confidence === "number" ? event.confidence : undefined,
    sourceLabel: normalizeText(event.shift),
    category: isScheduleImportCategory(event.category) ? event.category : undefined,
    rawText: normalizeText(event.rawText),
    assumedTime: event.assumedTime === true,
  };
}

function sanitizeNonEvent(item: ScheduleImportNonEvent): ScheduleImportNonEvent | null {
  const summary = normalizeText(item.summary);
  const category = item.category as ScheduleImportCategory;
  if (!summary || category === "event_importable" || !isScheduleImportCategory(category)) {
    return null;
  }
  return {
    summary,
    category,
    reason: normalizeText(item.reason),
    date: item.date && validateDate(item.date) ? item.date : undefined,
    shift: normalizeText(item.shift),
    rawText: normalizeText(item.rawText),
  };
}

async function extractPdfText(pdf: Buffer): Promise<string> {
  const require = createRequire(import.meta.url);
  const parse = require("pdf-parse-old") as (input: Buffer) => Promise<{ text?: string }>;
  const result = await parse(pdf);
  return result.text?.trim() ?? "";
}

export class OpenAiScheduleImportService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly logger: Logger,
  ) {}

  async extractFromPdf(input: {
    pdf: Buffer;
    sourceLabel: string;
    caption?: string;
    currentDate: string;
    timezone: string;
  }): Promise<ScheduleImportParseResult> {
    const extractedText = await extractPdfText(input.pdf);
    if (!extractedText) {
      throw new Error("Não consegui extrair texto útil do PDF enviado.");
    }

    return this.extractFromText({
      sourceType: "pdf",
      sourceLabel: input.sourceLabel,
      caption: input.caption,
      currentDate: input.currentDate,
      timezone: input.timezone,
      text: extractedText,
    });
  }

  async extractFromImage(input: {
    image: Buffer;
    mimeType: string;
    sourceLabel: string;
    caption?: string;
    currentDate: string;
    timezone: string;
  }): Promise<ScheduleImportParseResult> {
    const prompt = this.buildExtractionPrompt({
      sourceType: "imagem",
      currentDate: input.currentDate,
      timezone: input.timezone,
      caption: input.caption,
      text: undefined,
    });

    const imageUrl = `data:${input.mimeType};base64,${input.image.toString("base64")}`;
    const content = await this.request([
      {
        role: "system",
        content: "Você extrai agendas semanais em português e responde somente JSON válido.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageUrl } },
        ],
      },
    ], "gpt-4.1-mini");

    return this.parseModelResponse(content, input.timezone);
  }

  private async extractFromText(input: {
    sourceType: string;
    sourceLabel: string;
    caption?: string;
    currentDate: string;
    timezone: string;
    text: string;
  }): Promise<ScheduleImportParseResult> {
    const prompt = this.buildExtractionPrompt({
      sourceType: input.sourceType,
      currentDate: input.currentDate,
      timezone: input.timezone,
      caption: input.caption,
      text: input.text,
    });

    const content = await this.request([
      {
        role: "system",
        content: "Você extrai agendas semanais em português e responde somente JSON válido.",
      },
      {
        role: "user",
        content: prompt,
      },
    ]);

    return this.parseModelResponse(content, input.timezone);
  }

  private buildExtractionPrompt(input: {
    sourceType: string;
    currentDate: string;
    timezone: string;
    caption?: string;
    text?: string;
  }): string {
    return [
      "Extraia uma agenda semanal de abordagem social em português.",
      "Retorne somente JSON no formato:",
      JSON.stringify({
        events: [
          {
            date: "2026-04-06",
            startTime: "08:00",
            endTime: "12:00",
            summary: "Paulo, Juliana e Maira - Muralismo",
            description: "Detalhes, nomes e observações se houver.",
            location: "Casa da Sopa",
            shift: "manhã",
            confidence: 0.96,
            category: "event_importable",
            rawText: "linha original lida no documento",
            assumedTime: true,
          },
        ],
        nonEvents: [
          {
            summary: "Joacy e Luiz Eduardo: ver questão do RG",
            category: "demand",
            reason: "item estava na seção Demandas",
            rawText: "Demandas: Joacy e Luiz Eduardo: ver questão do RG",
          },
        ],
        assumptions: ["..."],
        uncertainties: ["..."],
      }),
      "Regras:",
      `- Data atual de referência: ${input.currentDate}.`,
      `- Timezone: ${input.timezone}.`,
      "- Use o ano corrente quando a agenda trouxer só dia/mês.",
      "- Não invente eventos nem locais.",
      "- Se houver turno 'manhã' e não houver horário explícito, use 08:00-12:00.",
      "- Se houver turno 'tarde' e não houver horário explícito, use 13:30-17:00.",
      "- Se houver turno integral e não houver horário explícito, use 08:00-17:00.",
      "- Se houver horário explícito no material, use o horário explícito em vez do padrão por turno.",
      "- Marque `assumedTime=true` quando o horário veio do padrão do turno.",
      "- Não junte linhas de pessoas diferentes em um único evento se isso misturar atividades distintas.",
      "- Use `category=event_importable` para compromisso real, reunião ou atividade de agenda.",
      "- Use `nonEvents` para `FERIADO`, itens de seção `Demandas:`, informativos e blocos ambíguos que não devem virar evento direto.",
      "- `FERIADO` deve ser `category=holiday`, não evento comum.",
      "- Itens de `Demandas:` devem ser `category=demand`, não evento comum.",
      "- Informativos como `Fora da carga`, `TI`, folga ou observações soltas devem ser `category=informational`.",
      "- Quando houver atividade + local, coloque o local em `location` e o restante em `summary`.",
      "- Em `summary`, prefira título curto e operacional; não cole blocos inteiros.",
      "- Preserve o texto em português.",
      ...(input.caption?.trim() ? [`- Contexto adicional do usuário: ${input.caption.trim()}`] : []),
      input.text
        ? ["", "Texto extraído:", input.text.trim()].join("\n")
        : "",
      "",
      `Origem: ${input.sourceType}.`,
    ].filter(Boolean).join("\n");
  }

  private async request(messages: OpenAIMessage[], modelOverride?: string): Promise<string> {
    const model = modelOverride ?? this.model;
    let lastError: unknown;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages,
          }),
          signal: AbortSignal.timeout(120000),
        });

        if (!response.ok) {
          const details = await response.text().catch(() => "");
          throw new Error(`OpenAI schedule import failed (${response.status}): ${details || response.statusText}`);
        }

        const data = await response.json() as OpenAIChatCompletionResponse;
        const content = data.choices?.[0]?.message?.content?.trim();
        if (!content) {
          throw new Error("OpenAI schedule import returned empty content");
        }

        return content;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn("Schedule import request attempt failed", {
          attempt,
          model,
          message,
        });
        if (attempt < 3 && /fetch failed|ECONNRESET|ETIMEDOUT|socket/i.test(message)) {
          await delay(500 * attempt);
          continue;
        }
        break;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private parseModelResponse(content: string, timeZone: string): ScheduleImportParseResult {
    const parsed = JSON.parse(extractJsonObject(content)) as ScheduleImportModelResponse;
    const events = (parsed.events ?? [])
      .map((event) => sanitizeEvent(event, timeZone))
      .filter((event): event is ScheduleImportDraftSeed => Boolean(event));
    const nonEvents = (parsed.nonEvents ?? [])
      .map((item) => sanitizeNonEvent(item))
      .filter((item): item is ScheduleImportNonEvent => Boolean(item));

    if (events.length === 0) {
      this.logger.warn("Schedule import produced no valid events", {
        model: this.model,
      });
      throw new Error("Não consegui identificar eventos válidos nesta agenda.");
    }

    return {
      events,
      nonEvents,
      assumptions: Array.isArray(parsed.assumptions)
        ? parsed.assumptions.map((item) => String(item).trim()).filter(Boolean)
        : [],
      uncertainties: Array.isArray(parsed.uncertainties)
        ? parsed.uncertainties.map((item) => String(item).trim()).filter(Boolean)
        : [],
    };
  }
}
