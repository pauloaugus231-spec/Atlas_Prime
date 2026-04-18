export type {
  IdentityProfile,
  IdentityProfile as PersonalOperationalProfile,
  UpdateIdentityProfileInput,
  UpdateIdentityProfileInput as UpdatePersonalOperationalProfileInput,
} from "./identity-profile.js";

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
