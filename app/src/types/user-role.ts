export const USER_ROLES = [
  "individual_contributor",
  "team_lead",
  "manager",
  "field_operator",
  "executive",
  "regulated_professional",
  "custom",
] as const;

export type UserRole = (typeof USER_ROLES)[number];
