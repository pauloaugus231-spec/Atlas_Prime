export const MEMORY_CATEGORIES = [
  "objective",
  "initiative",
  "task",
  "opportunity",
  "note",
] as const;

export const MEMORY_STATUSES = [
  "open",
  "active",
  "blocked",
  "done",
  "archived",
] as const;

export const MEMORY_PRIORITIES = [
  "low",
  "medium",
  "high",
] as const;

export const MEMORY_HORIZONS = [
  "today",
  "short",
  "medium",
  "long",
] as const;

export const MEMORY_STAGES = [
  "capture",
  "validate",
  "build",
  "launch",
  "sell",
  "automate",
  "scale",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemoryPriority = (typeof MEMORY_PRIORITIES)[number];
export type MemoryHorizon = (typeof MEMORY_HORIZONS)[number];
export type MemoryStage = (typeof MEMORY_STAGES)[number];

export interface OperationalMemoryItem {
  id: number;
  category: MemoryCategory;
  title: string;
  details: string | null;
  status: MemoryStatus;
  priority: MemoryPriority;
  horizon: MemoryHorizon;
  stage: MemoryStage;
  project: string | null;
  tags: string[];
  source: string | null;
  cashPotential: number | null;
  assetValue: number | null;
  automationValue: number | null;
  scaleValue: number | null;
  authorityValue: number | null;
  effort: number | null;
  confidence: number | null;
  priorityScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface RankedMemoryItem {
  item: OperationalMemoryItem;
  score: number;
  reason: string;
  recommendedAction: string;
}

export interface DailyFocusItem {
  item: OperationalMemoryItem;
  score: number;
  whyNow: string;
  nextAction: string;
}

export interface CreateMemoryItemInput {
  category: MemoryCategory;
  title: string;
  details?: string | null;
  status?: MemoryStatus;
  priority?: MemoryPriority;
  horizon?: MemoryHorizon;
  stage?: MemoryStage;
  project?: string | null;
  tags?: string[];
  source?: string | null;
  cashPotential?: number | null;
  assetValue?: number | null;
  automationValue?: number | null;
  scaleValue?: number | null;
  authorityValue?: number | null;
  effort?: number | null;
  confidence?: number | null;
}

export interface ListMemoryItemsFilters {
  category?: MemoryCategory;
  status?: MemoryStatus;
  priority?: MemoryPriority;
  horizon?: MemoryHorizon;
  stage?: MemoryStage;
  project?: string;
  search?: string;
  limit?: number;
  includeDone?: boolean;
}

export interface UpdateMemoryItemInput {
  id: number;
  title?: string;
  details?: string | null;
  status?: MemoryStatus;
  priority?: MemoryPriority;
  horizon?: MemoryHorizon;
  stage?: MemoryStage;
  project?: string | null;
  tags?: string[];
  cashPotential?: number | null;
  assetValue?: number | null;
  automationValue?: number | null;
  scaleValue?: number | null;
  authorityValue?: number | null;
  effort?: number | null;
  confidence?: number | null;
}
