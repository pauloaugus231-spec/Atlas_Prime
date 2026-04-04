import type { Logger } from "../types/logger.js";

export interface TrendNewsItem {
  title: string;
  url?: string;
  source?: string;
  snippet?: string;
}

export interface GoogleTrendItem {
  title: string;
  approxTraffic?: string;
  publishedAt?: string;
  pictureUrl?: string;
  pictureSource?: string;
  newsItems: TrendNewsItem[];
}

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
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escaped}>([\\s\\S]*?)</${escaped}>`, "i"));
  return match?.[1] ? normalizeWhitespace(decodeXml(match[1])) : undefined;
}

function extractRepeatedTags(block: string, tag: string): string[] {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`<${escaped}>([\\s\\S]*?)</${escaped}>`, "gi");
  const results: string[] = [];
  for (const match of block.matchAll(regex)) {
    if (match[1]) {
      results.push(normalizeWhitespace(decodeXml(match[1])));
    }
  }
  return results;
}

export class GoogleTrendsIntakeService {
  constructor(private readonly logger: Logger) {}

  async fetchBrazilDailyTrends(limit = 10): Promise<GoogleTrendItem[]> {
    const url = "https://trends.google.com/trending/rss?geo=BR";
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)",
        Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`Google Trends RSS failed (${response.status})`);
    }

    const xml = await response.text();
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
    const parsed = items.map((block) => {
      const newsTitles = extractRepeatedTags(block, "ht:news_item_title");
      const newsUrls = extractRepeatedTags(block, "ht:news_item_url");
      const newsSources = extractRepeatedTags(block, "ht:news_item_source");
      const newsSnippets = extractRepeatedTags(block, "ht:news_item_snippet");

      const newsItems = newsTitles.map((title, index) => ({
        title,
        url: newsUrls[index],
        source: newsSources[index],
        snippet: newsSnippets[index],
      }));

      return {
        title: extractTag(block, "title") ?? "(sem título)",
        approxTraffic: extractTag(block, "ht:approx_traffic"),
        publishedAt: extractTag(block, "pubDate"),
        pictureUrl: extractTag(block, "ht:picture"),
        pictureSource: extractTag(block, "ht:picture_source"),
        newsItems,
      } satisfies GoogleTrendItem;
    });

    this.logger.info("Fetched Google Trends daily feed", {
      count: parsed.length,
      limit,
    });

    return parsed.slice(0, Math.max(1, Math.min(limit, parsed.length)));
  }
}
