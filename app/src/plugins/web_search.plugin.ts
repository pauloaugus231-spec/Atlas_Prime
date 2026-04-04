import { WebResearchService, type WebResearchMode } from "../core/web-research.js";
import { defineToolPlugin } from "../types/plugin.js";

interface WebSearchParameters {
  query: string;
  max_results?: number;
  include_page_excerpt?: boolean;
  mode?: WebResearchMode;
}

export default defineToolPlugin<WebSearchParameters>({
  name: "web_search",
  description:
    "Searches the public web with source URLs and optional page excerpts for research, trend validation and idea validation.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        minLength: 2,
      },
      max_results: {
        type: "integer",
        default: 5,
        minimum: 1,
        maximum: 10,
      },
      include_page_excerpt: {
        type: "boolean",
        default: true,
      },
      mode: {
        type: "string",
        enum: ["quick", "executive", "deep"],
        default: "executive",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  async execute(parameters, context) {
    const service = new WebResearchService(context.logger.child({ scope: "web-search" }));
    const results = await service.search({
      query: parameters.query,
      maxResults: parameters.max_results,
      includePageExcerpt: parameters.include_page_excerpt,
      mode: parameters.mode,
    });

    return {
      ok: true,
      query: parameters.query,
      total: results.length,
      results,
    };
  },
});
