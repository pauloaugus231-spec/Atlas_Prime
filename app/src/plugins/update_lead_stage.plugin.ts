import { defineToolPlugin } from "../types/plugin.js";

interface UpdateLeadStageParameters {
  id: number;
  status?: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "dormant";
  notes?: string;
  next_follow_up_at?: string;
  last_contact_at?: string;
  estimated_monthly_value?: number;
  estimated_one_off_value?: number;
}

export default defineToolPlugin<UpdateLeadStageParameters>({
  name: "update_lead_stage",
  description:
    "Updates a lead stage and related CRM fields such as next follow-up or estimated value.",
  parameters: {
    type: "object",
    properties: {
      id: { type: "integer" },
      status: {
        type: "string",
        enum: ["new", "contacted", "qualified", "proposal", "won", "lost", "dormant"],
      },
      notes: { type: "string" },
      next_follow_up_at: { type: "string" },
      last_contact_at: { type: "string" },
      estimated_monthly_value: { type: "number" },
      estimated_one_off_value: { type: "number" },
    },
    required: ["id"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const lead = context.growthOps.updateLead({
      id: parameters.id,
      status: parameters.status,
      notes: parameters.notes,
      nextFollowUpAt: parameters.next_follow_up_at,
      lastContactAt: parameters.last_contact_at,
      estimatedMonthlyValue: parameters.estimated_monthly_value,
      estimatedOneOffValue: parameters.estimated_one_off_value,
    });

    return {
      ok: true,
      lead,
    };
  },
});
