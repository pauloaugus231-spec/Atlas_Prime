import { defineToolPlugin } from "../types/plugin.js";

export default defineToolPlugin({
  name: "list_allowed_spaces",
  description:
    "Lists the readable and writable spaces currently authorized for the agent, including domain-specific Mac roots.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  async execute(_parameters, context) {
    const roots = context.fileAccess.describeReadableRoots();
    return {
      ok: true,
      writable_workspace: roots.workspace,
      readable_roots: roots,
      recommended_domains: {
        authorized_dev: "projetos, repositorios e codigo",
        authorized_social: "materiais da area social e estudos sensiveis",
        authorized_content: "conteudos, roteiros, posts e ativos de midia",
        authorized_finance: "relatorios financeiros e controles de receita",
        authorized_admin: "documentos operacionais e administrativos",
      },
    };
  },
});
