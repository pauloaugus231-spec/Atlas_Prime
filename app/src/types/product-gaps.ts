import type { CapabilityGapKind } from "./capability.js";

export const PRODUCT_GAP_TYPES = [
  "capability_gap",
  "missing_tooling",
  "product_gap_from_usage",
  "maps_required",
  "web_search_missing",
  "travel_estimation_missing",
] as const;

export const PRODUCT_GAP_STATUS = [
  "open",
  "reviewed",
  "implemented",
  "dismissed",
] as const;

export type ProductGapType = (typeof PRODUCT_GAP_TYPES)[number];
export type ProductGapStatus = (typeof PRODUCT_GAP_STATUS)[number];

export interface ProductGapRecord {
  id: number;
  signature: string;
  type: ProductGapType;
  description: string;
  inferredObjective: string;
  missingCapabilities: string[];
  missingRequirementKinds: CapabilityGapKind[];
  contextSummary?: string;
  relatedSkill?: string;
  channel?: string;
  impact: "low" | "medium" | "high";
  recurrence: number;
  status: ProductGapStatus;
  createdAt: string;
  updatedAt: string;
  lastObservedAt: string;
}

export interface CreateProductGapObservationInput {
  signature: string;
  type: ProductGapType;
  description: string;
  inferredObjective: string;
  missingCapabilities: string[];
  missingRequirementKinds: CapabilityGapKind[];
  contextSummary?: string;
  relatedSkill?: string;
  channel?: string;
  impact?: ProductGapRecord["impact"];
}
