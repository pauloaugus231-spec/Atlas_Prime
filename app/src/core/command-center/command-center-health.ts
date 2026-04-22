import type { CommandCenterSnapshot } from "./command-center-types.js";

export class CommandCenterHealth {
  summarizeIntegrations(input: {
    googleReady: boolean;
    emailReady: boolean;
    whatsappEnabled: boolean;
  }): CommandCenterSnapshot["system"]["integrations"] {
    return {
      google: input.googleReady ? "ok" : "error",
      email: input.emailReady ? "ok" : "disabled",
      whatsapp: input.whatsappEnabled ? "ok" : "disabled",
    };
  }
}
