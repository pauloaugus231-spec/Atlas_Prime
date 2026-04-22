import { URL } from "node:url";
import type { ResearchSource } from "../../types/research-brief.js";

export class SourcePolicy {
  classify(url: string): Pick<ResearchSource, "sourceKind" | "reliability"> {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.endsWith(".gov.br") || host.endsWith(".gov") || host.endsWith(".edu") || host.endsWith(".org")) {
        return { sourceKind: "official", reliability: "high" };
      }
      if (host.includes("docs") || host.endsWith("developer.mozilla.org") || host.endsWith("developers.google.com")) {
        return { sourceKind: "docs", reliability: "high" };
      }
      if (host.includes("reddit") || host.includes("forum") || host.includes("community")) {
        return { sourceKind: "forum", reliability: "low" };
      }
      if (host.includes("news") || host.includes("globo") || host.includes("uol") || host.includes("folha")) {
        return { sourceKind: "news", reliability: "medium" };
      }
      return { sourceKind: "unknown", reliability: "medium" };
    } catch {
      return { sourceKind: "unknown", reliability: "low" };
    }
  }
}
