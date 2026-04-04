import type { Logger } from "../types/logger.js";

export type WebResearchMode = "quick" | "executive" | "deep";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  sourceHost: string;
  excerpt?: string;
  score?: number;
}

type SearchIntent = "general" | "institution" | "trend" | "market" | "competition";

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function extractTag(block: string, tag: string): string | undefined {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ? normalizeWhitespace(decodeXml(match[1])) : undefined;
}

function stripMarkdownMetadata(value: string): string {
  return value
    .replace(/^Title:\s.*$/gim, "")
    .replace(/^URL Source:\s.*$/gim, "")
    .replace(/^Published Time:\s.*$/gim, "")
    .replace(/^Warning:\s.*$/gim, "")
    .replace(/^Markdown Content:\s*/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeQuery(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function extractLocationHint(normalizedQuery: string): { phrase: string; terms: string[] } | undefined {
  const cleaned = normalizedQuery
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(endereco|endereço|telefone|contato)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const portoAlegreMatch = cleaned.match(/\bporto alegre\b/);
  if (portoAlegreMatch) {
    return {
      phrase: "porto alegre",
      terms: ["porto", "alegre"],
    };
  }

  const match = normalizedQuery.match(/\bem\s+([a-z ]{3,})$/i);
  if (!match?.[1]) {
    return undefined;
  }

  const phrase = match[1]
    .replace(/\s+/g, " ")
    .trim();

  const terms = phrase
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !["com", "para", "uma", "uns", "umas", "dos", "das"].includes(term));

  if (!phrase || terms.length === 0) {
    return undefined;
  }

  return { phrase, terms };
}

function matchesLocationHint(text: string, locationHint?: { phrase: string; terms: string[] }): boolean {
  if (!locationHint) {
    return true;
  }

  if (text.includes(locationHint.phrase)) {
    return true;
  }

  return locationHint.terms.every((term) => text.includes(term));
}

function inferResearchIntent(normalizedQuery: string): SearchIntent {
  if (
    normalizedQuery.includes("concorr") ||
    normalizedQuery.includes("competidor") ||
    normalizedQuery.includes("competicao") ||
    normalizedQuery.includes("competição") ||
    normalizedQuery.includes("alternativa")
  ) {
    return "competition";
  }

  if (
    normalizedQuery.includes("tendencia") ||
    normalizedQuery.includes("tendência") ||
    normalizedQuery.includes("trend") ||
    normalizedQuery.includes("em alta")
  ) {
    return "trend";
  }

  if (
    normalizedQuery.includes("mercado") ||
    normalizedQuery.includes("viabilidade") ||
    normalizedQuery.includes("oportunidade") ||
    normalizedQuery.includes("demanda") ||
    normalizedQuery.includes("precificacao") ||
    normalizedQuery.includes("precificação") ||
    normalizedQuery.includes("benchmark")
  ) {
    return "market";
  }

  if (
    normalizedQuery.includes("prefeitura") ||
    normalizedQuery.includes("instituto") ||
    normalizedQuery.includes("albergue") ||
    normalizedQuery.includes("abrigo") ||
    normalizedQuery.includes("secretaria") ||
    normalizedQuery.includes("porto alegre")
  ) {
    return "institution";
  }

  return "general";
}

function buildQueryCandidates(input: {
  query: string;
  preferredDomains?: string[];
  seedQueries?: string[];
  mode: WebResearchMode;
}): string[] {
  const normalized = normalizeQuery(input.query);
  const candidates: string[] = [];
  const locationHint = extractLocationHint(normalized);
  const preferredDomains = input.preferredDomains ?? [];
  const seedQueries = input.seedQueries ?? [];
  const intent = inferResearchIntent(normalized);

  candidates.push(...seedQueries.map((item) => item.trim()).filter(Boolean));

  if (normalized.includes("micro saas")) {
    candidates.push('"micro SaaS" trends 2026 startup opportunities market report');
    candidates.push('"micro SaaS" niches 2026 recurring revenue opportunities');
  }

  if (normalized.includes("albergue") && locationHint) {
    candidates.push(`"${locationHint.phrase}" albergue abrigo acolhimento`);
    candidates.push(`"${locationHint.phrase}" abrigo assistencia social prefeitura`);
  }

  if (intent === "competition") {
    candidates.push(`${input.query.trim()} concorrentes benchmarking pricing`);
    candidates.push(`${input.query.trim()} competitors alternatives pricing`);
    candidates.push(`site:g2.com ${input.query.trim()}`);
    candidates.push(`site:capterra.com ${input.query.trim()}`);
    candidates.push(`site:alternativeto.net ${input.query.trim()}`);
  }

  if (intent === "market") {
    candidates.push(`${input.query.trim()} mercado demanda oportunidades`);
    candidates.push(`${input.query.trim()} market report analysis 2026`);
    candidates.push(`site:explodingtopics.com ${input.query.trim()}`);
    candidates.push(`site:google.com ${input.query.trim()} trends`);
  }

  if (intent === "trend") {
    candidates.push(`${input.query.trim()} trends 2026 report`);
    candidates.push(`${input.query.trim()} google trends market report`);
    candidates.push(`site:explodingtopics.com ${input.query.trim()}`);
    candidates.push(`site:trends.google.com ${input.query.trim()}`);
  }

  if (intent === "institution" && locationHint) {
    candidates.push(`site:prefeitura.poa.br "${locationHint.phrase}"`);
    candidates.push(`site:mprs.mp.br "${locationHint.phrase}"`);
  }

  if (normalized.includes("tendencia") || normalized.includes("trend")) {
    const translated = normalized
      .replace(/\btendencias?\b/g, "trends")
      .replace(/\bna internet\b/g, "")
      .replace(/\bcom fontes\b/g, "")
      .replace(/\bem\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (translated && translated !== normalized) {
      candidates.push(translated);
    }
  }

  for (const domain of preferredDomains) {
    candidates.push(`site:${domain} ${input.query.trim()}`);
  }

  candidates.push(input.query.trim());

  const unique = [...new Set(candidates.filter(Boolean))];
  const limit = input.mode === "quick" ? 4 : input.mode === "deep" ? 8 : 6;
  return unique.slice(0, limit);
}

function matchesPreferredDomain(sourceHost: string, preferredDomains: string[]): boolean {
  return preferredDomains.some((domain) => sourceHost === domain || sourceHost.endsWith(`.${domain}`));
}

function scoreSearchResult(input: {
  normalizedQuery: string;
  normalizedContent: string;
  normalizedLink: string;
  sourceHost: string;
  preferredDomains: string[];
}): number {
  let score = 0;
  const intent = inferResearchIntent(input.normalizedQuery);

  if (matchesPreferredDomain(input.sourceHost, input.preferredDomains)) {
    score += 80;
  }

  if (input.sourceHost.endsWith(".gov.br") || input.sourceHost.includes(".gov.")) {
    score += 30;
  }

  if (input.sourceHost.endsWith(".org.br") || input.sourceHost.endsWith(".edu.br")) {
    score += 15;
  }

  if (intent === "competition" && ["g2.com", "capterra.com", "alternativeto.net", "producthunt.com"].some((domain) => input.sourceHost === domain || input.sourceHost.endsWith(`.${domain}`))) {
    score += 20;
  }

  if (intent === "market" && ["explodingtopics.com", "statista.com", "grandviewresearch.com", "marketsandmarkets.com", "ibisworld.com"].some((domain) => input.sourceHost === domain || input.sourceHost.endsWith(`.${domain}`))) {
    score += 18;
  }

  if (intent === "trend" && ["explodingtopics.com", "trends.google.com", "google.com", "reddit.com", "indiehackers.com"].some((domain) => input.sourceHost === domain || input.sourceHost.endsWith(`.${domain}`))) {
    score += 14;
  }

  for (const term of input.normalizedQuery.split(" ")) {
    const trimmed = term.trim();
    if (trimmed.length < 3) {
      continue;
    }
    if (input.normalizedContent.includes(trimmed)) {
      score += 6;
    }
    if (input.normalizedLink.includes(trimmed)) {
      score += 4;
    }
  }

  return score;
}

function isLowSignalHost(host: string, normalizedQuery: string): boolean {
  const genericHosts = [
    "wikipedia.org",
    "pt.m.wikipedia.org",
    "dicio.com.br",
    "albergues.com",
    "airbnb.com.br",
    "airbnb.com",
  ];

  if (genericHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    return true;
  }

  if (
    normalizedQuery.includes("albergue") &&
    (host.includes("dicionario") || host.includes("dictionary") || host.includes("hostel"))
  ) {
    return true;
  }

  return false;
}

function filterResultsForQuality(
  results: WebSearchResult[],
  normalizedQuery: string,
  preferredDomains: string[],
  maxResults: number,
): WebSearchResult[] {
  const preferred = results.filter((item) => matchesPreferredDomain(item.sourceHost, preferredDomains));
  if (preferred.length > 0) {
    return preferred.slice(0, maxResults);
  }

  const institutional = results.filter((item) =>
    item.sourceHost.endsWith(".gov.br") ||
    item.sourceHost.includes(".gov.") ||
    item.sourceHost.endsWith(".jus.br") ||
    item.sourceHost.endsWith(".org.br"),
  );
  if (institutional.length > 0) {
    return institutional.slice(0, maxResults);
  }

  return results
    .filter((item) => !isLowSignalHost(item.sourceHost, normalizedQuery))
    .slice(0, maxResults);
}

export class WebResearchService {
  constructor(private readonly logger: Logger) {}

  async search(input: {
    query: string;
    maxResults?: number;
    includePageExcerpt?: boolean;
    preferredDomains?: string[];
    seedQueries?: string[];
    mode?: WebResearchMode;
  }): Promise<WebSearchResult[]> {
    const query = input.query.trim();
    if (!query) {
      return [];
    }

    const mode = input.mode ?? "executive";
    const maxResults = Math.min(Math.max(input.maxResults ?? 5, 1), 10);
    const normalizedQuery = normalizeQuery(query);
    const locationHint = extractLocationHint(normalizedQuery);
    const preferredDomains = input.preferredDomains ?? [];
    const uniqueUrls = new Set<string>();
    const uniqueHosts = new Map<string, number>();
    const stagedResults: WebSearchResult[] = [];
    const candidateQueries = buildQueryCandidates({
      query,
      preferredDomains,
      seedQueries: input.seedQueries,
      mode,
    });

    const stageResult = (result: {
      title: string;
      link: string;
      description?: string;
      publishedAt?: string;
    }): void => {
      const title = normalizeWhitespace(decodeXml(result.title));
      const link = result.link.trim();
      const description = result.description ? normalizeWhitespace(decodeXml(result.description)) : "";
      if (!title || !link || uniqueUrls.has(link)) {
        return;
      }

      const normalizedContent = normalizeQuery(`${title} ${description}`);
      const normalizedLink = normalizeQuery(link);
      if (normalizedQuery.includes("micro saas") && !normalizedContent.includes("saas")) {
        return;
      }
      if (!matchesLocationHint(`${normalizedContent} ${normalizedLink}`, locationHint)) {
        return;
      }

      let sourceHost = "";
      try {
        sourceHost = new URL(link).hostname.replace(/^www\./, "");
      } catch {
        sourceHost = "";
      }

      const hostCount = uniqueHosts.get(sourceHost) ?? 0;
      if (sourceHost && hostCount >= 3) {
        return;
      }

      uniqueUrls.add(link);
      if (sourceHost) {
        uniqueHosts.set(sourceHost, hostCount + 1);
      }

      stagedResults.push({
        title,
        url: link,
        snippet: description,
        publishedAt: result.publishedAt,
        sourceHost,
        score: scoreSearchResult({
          normalizedQuery,
          normalizedContent,
          normalizedLink,
          sourceHost,
          preferredDomains,
        }),
      });
    };

    for (const candidateQuery of candidateQueries) {
      const rssResults = await this.fetchBingRssResults(candidateQuery, maxResults);
      for (const item of rssResults) {
        stageResult(item);
      }
    }

    if (mode !== "quick" && stagedResults.length < Math.max(4, maxResults)) {
      const ddgCandidateCount = mode === "deep" ? 4 : 2;
      for (const candidateQuery of candidateQueries.slice(0, ddgCandidateCount)) {
        const htmlResults = await this.fetchDuckDuckGoHtmlResults(candidateQuery, maxResults);
        for (const item of htmlResults) {
          stageResult(item);
        }
      }
    }

    const rankedResults = stagedResults
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, maxResults * 2);

    const results = filterResultsForQuality(rankedResults, normalizedQuery, preferredDomains, maxResults);

    if (input.includePageExcerpt !== false) {
      const excerptMaxChars = mode === "quick" ? 900 : mode === "deep" ? 2600 : 1600;
      for (const result of results) {
        try {
          result.excerpt = await this.fetchPageExcerpt(result.url, excerptMaxChars);
        } catch (error) {
          this.logger.warn("Failed to fetch page excerpt", {
            url: result.url,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    return results;
  }

  private async fetchBingRssResults(
    candidateQuery: string,
    maxResults: number,
  ): Promise<Array<{ title: string; link: string; description?: string; publishedAt?: string }>> {
    try {
      const url = new URL("https://www.bing.com/search");
      url.searchParams.set("q", candidateQuery);
      url.searchParams.set("format", "rss");
      url.searchParams.set("setlang", "en-US");

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
          Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(6000),
      });

      if (!response.ok) {
        throw new Error(`Web search failed with status ${response.status}`);
      }

      const xml = await response.text();
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
        .map((match) => match[1])
        .slice(0, maxResults * 3)
        .map((block) => ({
          title: extractTag(block, "title") ?? "",
          link: extractTag(block, "link") ?? "",
          description: extractTag(block, "description"),
          publishedAt: extractTag(block, "pubDate"),
        }))
        .filter((item) => item.title && item.link);
    } catch (error) {
      this.logger.warn("Bing RSS search failed", {
        candidateQuery,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async fetchDuckDuckGoHtmlResults(
    candidateQuery: string,
    maxResults: number,
  ): Promise<Array<{ title: string; link: string; description?: string }>> {
    try {
      const url = new URL("https://html.duckduckgo.com/html/");
      url.searchParams.set("q", candidateQuery);

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(7000),
      });

      if (!response.ok) {
        throw new Error(`DuckDuckGo search failed with status ${response.status}`);
      }

      const html = await response.text();
      const resultBlocks = [...html.matchAll(/<div class="result results_links(?:_deep)?[^"]*">([\s\S]*?)<\/div>\s*<\/div>/gi)]
        .map((match) => match[1])
        .slice(0, maxResults * 2);

      return resultBlocks
        .map((block) => {
          const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
          const snippetMatch =
            block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ??
            block.match(/<div[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i);
          const rawHref = linkMatch?.[1] ?? "";
          return {
            title: normalizeWhitespace(decodeXml((linkMatch?.[2] ?? "").replace(/<[^>]+>/g, " "))),
            link: this.resolveDuckDuckGoRedirect(rawHref),
            description: normalizeWhitespace(decodeXml((snippetMatch?.[1] ?? "").replace(/<[^>]+>/g, " "))),
          };
        })
        .filter((item) => item.title && item.link);
    } catch (error) {
      this.logger.warn("DuckDuckGo HTML search failed", {
        candidateQuery,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private resolveDuckDuckGoRedirect(rawHref: string): string {
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

  async fetchPageExcerpt(url: string, maxChars = 1600): Promise<string> {
    const normalizedUrl = url.replace(/^https?:\/\//i, "");
    const response = await fetch(`https://r.jina.ai/http://${normalizedUrl}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      throw new Error(`Page fetch failed with status ${response.status}`);
    }

    const markdown = stripMarkdownMetadata(await response.text());
    return markdown.slice(0, maxChars).trim();
  }
}
