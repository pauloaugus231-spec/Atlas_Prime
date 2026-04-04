import { defineToolPlugin } from "../types/plugin.js";

interface SearchGoogleContactsParameters {
  account?: string;
  query: string;
  limit?: number;
}

export default defineToolPlugin<SearchGoogleContactsParameters>({
  name: "search_google_contacts",
  description:
    "Searches Google Contacts in read-only mode to support secretary workflows and contact lookups.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 1,
      },
      account: {
        type: "string",
        description: "Optional Google account alias. Defaults to primary.",
      },
      limit: {
        type: "integer",
        default: 10,
        minimum: 1,
        maximum: 30,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const account = context.googleWorkspaces.resolveAlias(parameters.account);
    const workspace = context.googleWorkspaces.getWorkspace(account);
    const status = workspace.getStatus();
    if (!status.ready) {
      return {
        ok: false,
        account,
        status,
        contacts: [],
      };
    }

    const contacts = await workspace.searchContacts(parameters.query, parameters.limit);
    return {
      ok: true,
      account,
      status,
      total: contacts.length,
      contacts,
    };
  },
});
