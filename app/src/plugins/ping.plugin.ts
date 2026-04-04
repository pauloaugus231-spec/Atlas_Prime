import { defineToolPlugin } from "../types/plugin.js";

interface PingParameters {
  message?: string;
}

export default defineToolPlugin<PingParameters>({
  name: "ping",
  description: "Returns a simple health response to validate the plugin system.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Optional message to echo back in the response.",
      },
    },
    additionalProperties: false,
  },
  execute(parameters) {
    return {
      ok: true,
      pong: parameters.message?.trim() || "pong",
      timestamp: new Date().toISOString(),
    };
  },
});
