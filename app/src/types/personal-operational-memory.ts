export interface PersonalOperationalProfile {
  defaultAgendaScope: "primary" | "work" | "both";
  workCalendarAliases: string[];
  savedFocus: string[];
  routineAnchors: string[];
  operationalRules: string[];
  attire: {
    umbrellaProbabilityThreshold: number;
    coldTemperatureC: number;
    lightClothingTemperatureC: number;
    carryItems: string[];
  };
  fieldModeHours: number;
}

export interface UpdatePersonalOperationalProfileInput {
  defaultAgendaScope?: PersonalOperationalProfile["defaultAgendaScope"];
  workCalendarAliases?: string[];
  savedFocus?: string[];
  routineAnchors?: string[];
  operationalRules?: string[];
  attire?: Partial<PersonalOperationalProfile["attire"]>;
  fieldModeHours?: number;
}

export const PERSONAL_MEMORY_ITEM_KINDS = [
  "preference",
  "routine",
  "rule",
  "packing",
  "mobility",
  "context",
  "focus",
  "note",
] as const;

export type PersonalOperationalMemoryItemKind = (typeof PERSONAL_MEMORY_ITEM_KINDS)[number];

export interface PersonalOperationalMemoryItem {
  id: number;
  kind: PersonalOperationalMemoryItemKind;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreatePersonalOperationalMemoryItemInput {
  kind?: PersonalOperationalMemoryItemKind;
  title: string;
  content: string;
  tags?: string[];
}

export interface UpdatePersonalOperationalMemoryItemInput {
  id: number;
  kind?: PersonalOperationalMemoryItemKind;
  title?: string;
  content?: string;
  tags?: string[];
}
