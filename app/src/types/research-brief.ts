export interface ResearchSource {
  title: string;
  url: string;
  sourceKind: "official" | "news" | "forum" | "docs" | "marketplace" | "unknown";
  retrievedAt: string;
  reliability: "high" | "medium" | "low";
  excerpt?: string;
}

export interface ResearchBrief {
  id: string;
  topic: string;
  question: string;
  collectedAt: string;
  sources: ResearchSource[];
  facts: string[];
  inferences: string[];
  opportunities: string[];
  risks: string[];
  recommendedActions: string[];
}
