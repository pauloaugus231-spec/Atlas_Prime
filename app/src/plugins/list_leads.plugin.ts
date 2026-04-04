import { defineToolPlugin } from "../types/plugin.js";

interface ListLeadsParameters {
  status?: "new" | "contacted" | "qualified" | "proposal" | "won" | "lost" | "dormant";
  domain?: string;
  search?: string;
  limit?: number;
}

export default defineToolPlugin<ListLeadsParameters>({
  name: "list_leads",
  description:
    "Lists leads from the local growth CRM, filtered by stage, domain or search term.",
  parameters: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["new", "contacted", "qualified", "proposal", "won", "lost", "dormant"],
      },
      domain: { type: "string" },
      search: { type: "string" },
      limit: {
        type: "integer",
        default: 20,
        minimum: 1,
        maximum: 100,
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const leads = context.growthOps.listLeads({
      status: parameters.status,
      domain: parameters.domain,
      search: parameters.search,
      limit: parameters.limit,
    });

    return {
      ok: true,
      total: leads.length,
      leads,
    };
  },
});
