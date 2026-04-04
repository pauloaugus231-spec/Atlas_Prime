import { defineToolPlugin } from "../types/plugin.js";

interface SaveLeadParameters {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  source?: string;
  status?: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "dormant";
  domain?: string;
  estimated_monthly_value?: number;
  estimated_one_off_value?: number;
  notes?: string;
  next_follow_up_at?: string;
  last_contact_at?: string;
}

export default defineToolPlugin<SaveLeadParameters>({
  name: "save_lead",
  description:
    "Persists a lead or potential client in the local growth CRM, including stage, value and next follow-up.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
      company: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      source: { type: "string" },
      status: {
        type: "string",
        enum: ["new", "contacted", "qualified", "proposal", "won", "lost", "dormant"],
        default: "new",
      },
      domain: { type: "string" },
      estimated_monthly_value: { type: "number" },
      estimated_one_off_value: { type: "number" },
      notes: { type: "string" },
      next_follow_up_at: { type: "string" },
      last_contact_at: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const lead = context.growthOps.createLead({
      name: parameters.name,
      company: parameters.company,
      email: parameters.email,
      phone: parameters.phone,
      source: parameters.source,
      status: parameters.status,
      domain: parameters.domain,
      estimatedMonthlyValue: parameters.estimated_monthly_value,
      estimatedOneOffValue: parameters.estimated_one_off_value,
      notes: parameters.notes,
      nextFollowUpAt: parameters.next_follow_up_at,
      lastContactAt: parameters.last_contact_at,
    });

    return {
      ok: true,
      lead,
    };
  },
});
