import type { BriefingProfileStyle, BriefingSectionKey } from "../types/briefing-profile.js";
import type { UserRole } from "../types/user-role.js";

export interface BriefingTemplatePack {
  role: UserRole;
  style: BriefingProfileStyle;
  sections: BriefingSectionKey[];
}

const PACKS: Record<UserRole, BriefingTemplatePack> = {
  individual_contributor: {
    role: "individual_contributor",
    style: "executive",
    sections: ["weather", "focus", "next_action", "agenda", "tasks", "motivation"],
  },
  team_lead: {
    role: "team_lead",
    style: "executive",
    sections: ["focus", "next_action", "goals", "agenda", "approvals", "workflows", "motivation"],
  },
  manager: {
    role: "manager",
    style: "executive",
    sections: ["focus", "next_action", "goals", "agenda", "emails", "approvals", "workflows"],
  },
  field_operator: {
    role: "field_operator",
    style: "compact",
    sections: ["weather", "focus", "next_action", "agenda", "mobility", "motivation"],
  },
  executive: {
    role: "executive",
    style: "executive",
    sections: ["focus", "next_action", "goals", "agenda", "approvals", "workflows"],
  },
  regulated_professional: {
    role: "regulated_professional",
    style: "executive",
    sections: ["weather", "focus", "next_action", "agenda", "tasks", "motivation"],
  },
  custom: {
    role: "custom",
    style: "auto",
    sections: ["weather", "focus", "next_action", "agenda", "tasks", "motivation"],
  },
};

export function getBriefingTemplatePack(role: UserRole | undefined): BriefingTemplatePack {
  return PACKS[role ?? "custom"] ?? PACKS.custom;
}
