import { defineToolPlugin } from "../types/plugin.js";

interface UpdateUserPreferencesParameters {
  response_style?: "executive" | "detailed" | "investigative" | "secretary";
  response_length?: "short" | "medium";
  proactive_next_step?: boolean;
  auto_source_fallback?: boolean;
  preferred_agent_name?: string;
}

export default defineToolPlugin<UpdateUserPreferencesParameters>({
  name: "update_user_preferences",
  description: "Updates persisted user preferences that define response style, preferred agent name and secretary fallback behavior.",
  parameters: {
    type: "object",
    properties: {
      response_style: {
        type: "string",
        enum: ["executive", "detailed", "investigative", "secretary"],
      },
      response_length: {
        type: "string",
        enum: ["short", "medium"],
      },
      proactive_next_step: {
        type: "boolean",
      },
      auto_source_fallback: {
        type: "boolean",
      },
      preferred_agent_name: {
        type: "string",
        minLength: 1,
        maxLength: 50,
      },
    },
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const preferences = context.preferences.update({
      responseStyle: parameters.response_style,
      responseLength: parameters.response_length,
      proactiveNextStep: parameters.proactive_next_step,
      autoSourceFallback: parameters.auto_source_fallback,
      preferredAgentName: parameters.preferred_agent_name,
    });

    return {
      ok: true,
      preferences,
    };
  },
});
