import { defineToolPlugin } from "../types/plugin.js";

interface SaveRevenueEntryParameters {
  title: string;
  amount: number;
  kind?: "recurring" | "one_off";
  status?: "projected" | "won" | "received" | "lost";
  channel?: string;
  reference_month: string;
  received_at?: string;
  notes?: string;
}

export default defineToolPlugin<SaveRevenueEntryParameters>({
  name: "save_revenue_entry",
  description:
    "Stores a projected, won or received revenue entry for the monthly growth scoreboard.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", minLength: 1 },
      amount: { type: "number" },
      kind: {
        type: "string",
        enum: ["recurring", "one_off"],
        default: "one_off",
      },
      status: {
        type: "string",
        enum: ["projected", "won", "received", "lost"],
        default: "projected",
      },
      channel: { type: "string" },
      reference_month: {
        type: "string",
        description: "Month in YYYY-MM format.",
        pattern: "^\\d{4}-\\d{2}$",
      },
      received_at: { type: "string" },
      notes: { type: "string" },
    },
    required: ["title", "amount", "reference_month"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const entry = context.growthOps.createRevenueEntry({
      title: parameters.title,
      amount: parameters.amount,
      kind: parameters.kind,
      status: parameters.status,
      channel: parameters.channel,
      referenceMonth: parameters.reference_month,
      receivedAt: parameters.received_at,
      notes: parameters.notes,
    });

    return {
      ok: true,
      entry,
    };
  },
});
