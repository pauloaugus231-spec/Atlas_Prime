import { normalizeEmailAnalysisText } from "../integrations/email/email-analysis.js";
import type { GoogleMapsService } from "../integrations/google/google-maps.js";
import type { Logger } from "../types/logger.js";
import type { WebResearchService } from "./web-research.js";

function includesAny(source: string, tokens: string[]): boolean {
  return tokens.some((token) => source.includes(token));
}

export function buildWebResearchReply(input: {
  query: string;
  aliasLabel?: string;
  results: Array<{
    title: string;
    url: string;
    sourceHost: string;
    snippet: string;
    excerpt?: string;
    publishedAt?: string;
  }>;
}): string {
  if (input.results.length === 0) {
    return `Não encontrei resultados web úteis para: ${input.query}.`;
  }

  const lines = [`Encontrei ${input.results.length} fonte${input.results.length > 1 ? "s" : ""} útil${input.results.length > 1 ? "eis" : ""} sobre ${input.query}.`];
  if (input.aliasLabel) {
    lines.push(`Contexto reconhecido: ${input.aliasLabel}.`);
  }

  lines.push("", "Fontes:");
  for (const [index, item] of input.results.entries()) {
    const summary = item.snippet || item.excerpt?.slice(0, 180) || "";
    const published = item.publishedAt ? ` | ${item.publishedAt}` : "";
    lines.push(`${index + 1}. ${item.title} — ${item.sourceHost || item.url}${published}`);
    lines.push(`   ${item.url}`);
    if (item.publishedAt) {
      // already included inline for a tighter reply
    }
    if (summary) {
      lines.push(`   ${summary}`);
    }
  }

  lines.push("", "Se quiser, eu aprofundo isso ou filtro só por fontes oficiais.");
  return lines.join("\n");
}

export function buildInternalKnowledgeReply(input: {
  query: string;
  aliasLabel?: string;
  matches: Array<{
    rootLabel: string;
    relativePath: string;
    snippet: string;
    absolutePath: string;
  }>;
}): string {
  if (input.matches.length === 0) {
    return `Não encontrei evidência interna útil para: ${input.query}.`;
  }

  const lines = [`Busca interna para: ${input.query}`];
  if (input.aliasLabel) {
    lines.push(`Entidade reconhecida: ${input.aliasLabel}`);
  }

  lines.push("", "Evidência interna encontrada:");
  for (const [index, item] of input.matches.entries()) {
    lines.push(`${index + 1}. ${item.rootLabel}/${item.relativePath}`);
    lines.push(`   Arquivo: ${item.absolutePath}`);
    lines.push(`   Trecho: ${item.snippet}`);
  }

  return lines.join("\n");
}

export function isAddressLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual endereco",
    "qual endereço",
    "endereco de",
    "endereço de",
    "onde fica",
    "qual o endereco",
    "qual o endereço",
    ", endereco",
    ", endereço",
    " endereco",
    " endereço",
  ]);
}

export function isPhoneLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual telefone",
    "telefone",
    "fone",
    "contato",
    "whatsapp",
    "numero",
    "número",
  ]);
}

export function isHoursLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "qual horario",
    "qual horário",
    "horario",
    "horário",
    "funcionamento",
    "abre",
    "fecha",
    "atendimento",
  ]);
}

export function isCapacityLookupPrompt(prompt: string): boolean {
  const normalized = normalizeEmailAnalysisText(prompt);
  return includesAny(normalized, [
    "capacidade",
    "quantas vagas",
    "quantos acolhe",
    "quantas pessoas",
    "numero de vagas",
    "número de vagas",
    "vagas",
  ]);
}

export type ResearchFactType = "address" | "phone" | "hours" | "capacity";

export function extractRequestedResearchFactTypes(prompt: string): ResearchFactType[] {
  const types: ResearchFactType[] = [];
  if (isAddressLookupPrompt(prompt)) {
    types.push("address");
  }
  if (isPhoneLookupPrompt(prompt)) {
    types.push("phone");
  }
  if (isHoursLookupPrompt(prompt)) {
    types.push("hours");
  }
  if (isCapacityLookupPrompt(prompt)) {
    types.push("capacity");
  }
  return types;
}

export function extractAddressFromText(text: string): string | undefined {
  const finalizeAddress = (value: string | undefined): string | undefined => {
    const normalized = value
      ?.replace(/\blogradouro\s*:\s*/gi, "")
      .replace(/\bendere[cç]o\s*:\s*/gi, "")
      .replace(/\b(?:n[uú]mero|numero)\s*:\s*(\d{1,6})/gi, ", $1")
      .replace(/\bbairro\s*:\s*/gi, " - ")
      .replace(/\bmunic[ií]pio\s*:\s*/gi, " - ")
      .replace(/\bcidade\s*:\s*/gi, " - ")
      .replace(/\bestado\s*:\s*[A-Z]{2}\b/gi, "")
      .replace(/\bcep\s*:\s*\d{5}-?\d{3}\b/gi, "")
      .replace(/\s+,/g, ",")
      .replace(/\s+-\s+/g, " - ")
      .replace(/\s{2,}/g, " ")
      .replace(/\s+-$/g, "")
      .trim();

    return normalized?.replace(/\s+/g, " ").trim() || undefined;
  };

  const explicitMatch = text.match(
    /endere[cç]o:\s*((?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\s+[^.;\n]+?porto alegre(?:\/rs|, rs)?)/i,
  );
  if (explicitMatch?.[1]) {
    return finalizeAddress(explicitMatch[1]);
  }

  const structuredMatch = text.match(
    /\b(?:logradouro|endere[cç]o)\s*:?\s*((?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\s+[^\n.;]+?)\s+(?:n[uú]mero|numero)\s*:?\s*(\d{1,6})(?:[^\n.;]*?\bbairro\b\s*:?\s*([^\n.;]+))?/i,
  );
  if (structuredMatch?.[1] && structuredMatch?.[2]) {
    const street = structuredMatch[1].replace(/\s+/g, " ").trim();
    const number = structuredMatch[2].trim();
    const neighborhood = structuredMatch[3]?.replace(/\s+/g, " ").trim();
    return finalizeAddress([street, number, neighborhood].filter(Boolean).join(" - "));
  }

  const match = text.match(
    /\b(?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\s+[^,\n.;]+(?:,\s*|\s+)\d+[^\n.;]*/i,
  );
  const raw = match?.[0]?.replace(/\s+/g, " ").trim();
  if (!raw) {
    return undefined;
  }

  const portoAlegreIndex = raw.toLowerCase().indexOf("porto alegre");
  if (portoAlegreIndex !== -1) {
    return finalizeAddress(raw.slice(0, portoAlegreIndex + "porto alegre".length).trim());
  }

  return finalizeAddress(raw);
}

export function extractPhoneFromText(text: string): string | undefined {
  const explicitMatch = text.match(
    /\b(?:telefone|fone|whatsapp|contato)\s*:?\s*((?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4}))/i,
  );
  if (explicitMatch?.[1]) {
    return explicitMatch[1].replace(/\s+/g, " ").trim();
  }

  const genericMatch = text.match(
    /\b(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4}[-.\s]?\d{4}|\d{4}[-.\s]?\d{4})\b/,
  );
  return genericMatch?.[0]?.replace(/\s+/g, " ").trim();
}

export function extractHoursFromText(text: string): string | undefined {
  const match =
    text.match(/\bhor[aá]rio:\s*((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)/i) ??
    text.match(/\b((?:das|de)\s*\d{1,2}h(?:\s*\d{0,2})?\s*(?:às|as|a)\s*\d{1,2}h(?:\s*\d{0,2})?)\b/i);
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

export function extractCapacityFromText(text: string): string | undefined {
  const explicitMatch =
    text.match(/\bcapacidade(?:\s+total)?(?:\s+citada)?\s*(?:de|para)?\s*(\d{1,4})\s*(?:vagas|pessoas)\b/i) ??
    text.match(/\b(\d{1,4})\s*(?:vagas|pessoas)\b/i);
  if (!explicitMatch?.[1]) {
    return undefined;
  }

  const total = explicitMatch[1];
  const male =
    text.match(/\b(\d{1,4})\s*(?:na\s+)?ala\s+masculina\b/i) ??
    text.match(/\b(\d{1,4})\s+na\s+masculina\b/i) ??
    text.match(/\bmasculin[ao]\s*[:|-]?\s*(\d{1,4})\b/i);
  const female =
    text.match(/\b(\d{1,4})\s*(?:na\s+)?ala\s+feminina\b/i) ??
    text.match(/\b(\d{1,4})\s+na\s+feminina\b/i) ??
    text.match(/\bfeminin[ao]\s*[:|-]?\s*(\d{1,4})\b/i);

  const details = [];
  if (male?.[1]) {
    details.push(`${male[1]} masculina`);
  }
  if (female?.[1]) {
    details.push(`${female[1]} feminina`);
  }

  return details.length > 0 ? `${total} vagas (${details.join(", ")})` : `${total} vagas`;
}

export function buildAddressLookupReply(input: {
  query: string;
  address: string;
  aliasLabel?: string;
  sources: Array<{ label: string; url?: string; filePath?: string }>;
}): string {
  const lines = [];
  if (input.aliasLabel) {
    lines.push(`Endereço identificado para ${input.aliasLabel}:`);
  } else {
    lines.push(`Endereço identificado para a consulta: ${input.query}`);
  }
  lines.push(input.address, "", "Fontes:");
  for (const source of input.sources) {
    if (source.url) {
      lines.push(`- ${source.label}: ${source.url}`);
    } else if (source.filePath) {
      lines.push(`- ${source.label}: ${source.filePath}`);
    }
  }
  return lines.join("\n");
}

export function buildDeterministicFactLookupReply(input: {
  query: string;
  aliasLabel?: string;
  facts: Partial<Record<ResearchFactType, string>>;
  requestedTypes: ResearchFactType[];
  sources: Array<{ label: string; url?: string; filePath?: string }>;
}): string {
  const label = input.aliasLabel ?? input.query;
  const allTypes: ResearchFactType[] =
    input.requestedTypes.length > 0 ? input.requestedTypes : (["address", "phone", "hours", "capacity"] as ResearchFactType[]);
  const factLabels: Record<ResearchFactType, string> = {
    address: "Endereço",
    phone: "Telefone",
    hours: "Horário",
    capacity: "Capacidade",
  };

  const resolvedTypes = allTypes.filter((type) => Boolean(input.facts[type]));
  const unresolved = allTypes.filter((type) => !input.facts[type]);

  if (allTypes.length === 1 && resolvedTypes.length === 1) {
    const type = resolvedTypes[0];
    const value = input.facts[type]!;
    const primarySource = input.sources[0];
    const lines = [`${factLabels[type]} do ${label}: ${value}.`];
    if (primarySource?.url) {
      lines.push(`Fonte: ${primarySource.label} - ${primarySource.url}`);
    } else if (primarySource?.filePath) {
      lines.push(`Fonte: ${primarySource.label} - ${primarySource.filePath}`);
    }
    lines.push("Se quiser, eu também posso trazer telefone, horário ou capacidade.");
    return lines.join("\n");
  }

  const lines = [`Informações identificadas para ${label}:`];

  for (const type of allTypes) {
    const value = input.facts[type];
    if (value) {
      lines.push(`- ${factLabels[type]}: ${value}`);
    }
  }

  if (unresolved.length > 0) {
    lines.push(
      "",
      `Sem evidência suficiente nas fontes atuais para: ${unresolved.map((type) => factLabels[type].toLowerCase()).join(", ")}.`,
    );
  }

  if (input.sources.length > 0) {
    lines.push("", "Fontes:");
    for (const source of input.sources) {
      if (source.url) {
        lines.push(`- ${source.label}: ${source.url}`);
      } else if (source.filePath) {
        lines.push(`- ${source.label}: ${source.filePath}`);
      }
    }
  }

  return lines.join("\n");
}

export function extractResearchFacts(text: string): string[] {
  const facts: string[] = [];
  const address = extractAddressFromText(text);
  if (address) {
    facts.push(`Endereço: ${address}`);
  }

  const phone = extractPhoneFromText(text);
  if (phone) {
    facts.push(`Telefone: ${phone}`);
  }

  const hours = extractHoursFromText(text);
  if (hours) {
    facts.push(`Horário: ${hours}`);
  }

  const capacity = extractCapacityFromText(text);
  if (capacity) {
    facts.push(`Capacidade: ${capacity}`);
  }

  if (/\balbergue noturno\b/i.test(text)) {
    facts.push("Serviço mencionado: albergue noturno");
  }

  if (/\bcasa do pequenino\b/i.test(text)) {
    facts.push("Nome relacionado: Casa do Pequenino");
  }

  return [...new Set(facts)];
}

export function looksLikePostalAddress(value: string | undefined): boolean {
  const text = value?.trim() ?? "";
  if (!text) {
    return false;
  }

  return /\b(?:av(?:enida)?\.?|rua|r\.|travessa|tv\.|alameda|pra[cç]a|estrada|est\.?)\b/i.test(text) && /\b\d+\b/.test(text);
}

export function buildEventLocationResearchQuery(location: string, prompt: string): string {
  const normalizedPrompt = normalizeEmailAnalysisText(prompt);
  const parts = [`"${location}"`, "endereco"];
  if (normalizedPrompt.includes("porto alegre") || normalizedPrompt.includes("restinga")) {
    parts.push("porto alegre");
  }
  return parts.join(" ");
}

export function buildLocationTermHints(location: string): string[] {
  return normalizeEmailAnalysisText(location)
    .split(" ")
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !["quadra", "arena", "campo", "sports", "sport", "clube"].includes(item));
}

export function isAmbiguousPublicServiceLocation(location: string): boolean {
  const normalized = normalizeEmailAnalysisText(location).replace(/\s+/g, " ").trim();
  const match = normalized.match(/^(caps|creas|cras|ubs|upa)\b(?:\s+(.+))?$/i);
  if (!match) {
    return false;
  }

  const qualifier = (match[2] ?? "")
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !["de", "da", "do", "dos", "das"].includes(item));

  if (qualifier.length === 0) {
    return true;
  }

  return qualifier.every((item) => /^(adulto|infantil|ad|ii|iii|iv|v|vi)$/i.test(item) || item.length <= 2);
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function stripHtmlTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function resolveDuckDuckGoRedirectUrl(rawHref: string): string {
  if (!rawHref) {
    return "";
  }

  try {
    const parsed = new URL(rawHref, "https://html.duckduckgo.com");
    const redirected = parsed.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : parsed.toString();
  } catch {
    return rawHref;
  }
}

export async function lookupVenueAddress(
  location: string,
  prompt: string,
  logger: Logger,
  maps: GoogleMapsService,
): Promise<string | undefined> {
  const normalizedPrompt = normalizeEmailAnalysisText(prompt);
  const normalizedLocation = normalizeEmailAnalysisText(location);
  const locationHints = buildLocationTermHints(location);
  const cityHints = new Set<string>();

  if (normalizedPrompt.includes("porto alegre") || normalizedLocation.includes("porto alegre")) {
    cityHints.add("porto alegre");
  }
  if (normalizedPrompt.includes("restinga") || normalizedLocation.includes("restinga")) {
    cityHints.add("restinga");
    cityHints.add("porto alegre");
  }

  const looksLikeGenericPublicService = isAmbiguousPublicServiceLocation(location) && cityHints.size === 0;
  if (looksLikeGenericPublicService) {
    logger.info("Skipping venue address enrichment due to ambiguous public-service location", {
      location,
      prompt,
    });
    return undefined;
  }

  const compactLocation = location.replace(/\bna\b/gi, " ").replace(/\s+/g, " ").trim();
  const queries = [
    `${compactLocation} ${[...cityHints].join(" ")} endereco`,
    `"${compactLocation}" ${[...cityHints].join(" ")} endereco`,
    `${compactLocation} ${[...cityHints].join(" ")} cnpj`,
  ]
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const mapsStatus = maps.getStatus();
  if (mapsStatus.ready) {
    for (const query of [...new Set(queries)]) {
      try {
        const result = await maps.lookupPlace(query);
        if (result?.formattedAddress) {
          logger.info("Resolved venue address from Google Maps", {
            location,
            query,
            address: result.formattedAddress,
            mapsUrl: result.mapsUrl,
          });
          return result.formattedAddress;
        }
      } catch (error) {
        logger.warn("Venue address lookup failed on Google Maps", {
          location,
          query,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  for (const query of [...new Set(queries)]) {
    try {
      const url = new URL("https://html.duckduckgo.com/html/");
      url.searchParams.set("q", query);
      url.searchParams.set("kl", "br-pt");

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        continue;
      }

      const html = await response.text();
      const entries = [...html.matchAll(
        /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>)/gi,
      )]
        .map((match) => ({
          href: match[1] ?? "",
          title: match[2] ?? "",
          snippet: match[3] ?? match[4] ?? "",
        }))
        .slice(0, 8);

      for (const entry of entries) {
        const title = stripHtmlTags(entry.title);
        const snippet = stripHtmlTags(entry.snippet);
        const resultUrl = resolveDuckDuckGoRedirectUrl(entry.href);
        const combined = `${title} ${snippet} ${resultUrl}`.trim();
        const normalizedCombined = normalizeEmailAnalysisText(combined);

        if (
          locationHints.length > 0 &&
          !locationHints.every((term) => normalizedCombined.includes(normalizeEmailAnalysisText(term)))
        ) {
          continue;
        }

        const address = extractAddressFromText(combined);
        if (address) {
          logger.info("Resolved venue address from DuckDuckGo snippets", {
            location,
            query,
            resultUrl,
            address,
          });
          return address;
        }
      }
    } catch (error) {
      logger.warn("Venue address lookup failed", {
        location,
        query,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return undefined;
}

export async function fetchOfficialAliasSources(
  service: WebResearchService,
  urls: string[],
  logger: Logger,
  focusTerms: string[] = [],
  maxChars = 2200,
): Promise<Array<{ title: string; url: string; sourceHost: string; excerpt?: string }>> {
  const results: Array<{ title: string; url: string; sourceHost: string; excerpt?: string }> = [];

  for (const url of urls) {
    try {
      const sourceHost = new URL(url).hostname.replace(/^www\./, "");
      const excerpt = await (async () => {
        try {
          return url.toLowerCase().endsWith(".pdf")
            ? await service.fetchPageExcerpt(url, Math.min(maxChars, 2200))
            : await fetchOfficialHtmlExcerpt(url, focusTerms, maxChars);
        } catch {
          return await service.fetchPageExcerpt(url, maxChars);
        }
      })();
      results.push({
        title: sourceHost,
        url,
        sourceHost,
        excerpt,
      });
    } catch (error) {
      logger.warn("Failed to fetch official alias source", {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}

export function inferOfficialFallbackUrls(query: string, aliasOfficialUrls?: string[]): string[] {
  const urls = new Set(aliasOfficialUrls ?? []);
  const normalized = normalizeEmailAnalysisText(query);

  if (normalized.includes("albergue") && normalized.includes("porto alegre")) {
    urls.add("https://prefeitura.poa.br/fasc/albergue");
    urls.add("https://prefeitura.poa.br/gp/noticias/capital-tera-dois-novos-albergues-para-pessoas-em-situacao-de-rua");
  }

  return [...urls];
}

export function stripResearchReplyMarkdown(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function buildResearchFocusTerms(query: string, alias?: { terms?: string[]; matchedTerms?: string[] }): string[] {
  const terms = new Set<string>();
  for (const term of alias?.matchedTerms ?? []) {
    if (term.trim()) {
      terms.add(term.trim());
    }
  }
  for (const term of alias?.terms ?? []) {
    if (term.trim()) {
      terms.add(term.trim());
    }
  }

  const normalized = normalizeEmailAnalysisText(query)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(" ")
    .map((item) => item.trim())
    .filter(
      (item) =>
        item.length >= 4 &&
        !["sobre", "pesquise", "internet", "fontes", "rapida", "rápida", "executiva", "profunda"].includes(item),
    );

  for (const item of normalized) {
    terms.add(item);
  }

  if (normalizeEmailAnalysisText(query).includes("albergue")) {
    terms.add("azenha");
    terms.add("19h");
    terms.add("7h");
  }

  return [...terms];
}

export type ResearchSynthesisProfile = "general" | "market";

export function inferResearchSynthesisProfile(prompt: string, query: string): ResearchSynthesisProfile {
  const normalized = normalizeEmailAnalysisText(`${prompt} ${query}`);
  if (
    includesAny(normalized, [
      "mercado",
      "concorr",
      "benchmark",
      "demanda",
      "oportunidade",
      "riscos",
      "viabilidade",
      "tendencia",
      "tendência",
      "sinais de demanda",
    ])
  ) {
    return "market";
  }

  return "general";
}

export function extractFocusedExcerpt(text: string, focusTerms: string[], maxChars: number): string {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) {
    return "";
  }

  const lower = cleanText.toLowerCase();
  const candidates = focusTerms
    .map((term) => {
      const normalizedTerm = term.toLowerCase();
      return {
        term,
        position: lower.indexOf(normalizedTerm),
        weight: normalizedTerm.length,
      };
    })
    .filter((candidate) => candidate.position >= 0)
    .sort((left, right) => right.weight - left.weight || left.position - right.position);

  if (candidates.length === 0) {
    return cleanText.slice(0, maxChars).trim();
  }

  const best = candidates[0];
  const start = Math.max(0, best.position - Math.floor(maxChars * 0.18));
  return cleanText.slice(start, start + maxChars).trim();
}

export function scoreFocusedExcerpt(excerpt: string | undefined, focusTerms: string[]): number {
  if (!excerpt) {
    return 0;
  }

  const normalizedExcerpt = normalizeEmailAnalysisText(excerpt);
  let score = 0;
  for (const term of focusTerms) {
    const normalizedTerm = normalizeEmailAnalysisText(term);
    if (!normalizedTerm || normalizedTerm.length < 3) {
      continue;
    }
    if (normalizedExcerpt.includes(normalizedTerm)) {
      score += 20;
    }
  }
  return score;
}

export async function fetchOfficialHtmlExcerpt(url: string, focusTerms: string[] = [], maxChars = 4000): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) {
    throw new Error(`Official source fetch failed with status ${response.status}`);
  }

  const html = await response.text();
  const plainText = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
  return extractFocusedExcerpt(plainText, focusTerms, maxChars);
}
