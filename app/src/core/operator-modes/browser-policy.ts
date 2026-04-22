import type { BrowserTaskMode } from "../../types/browser-task.js";

export class BrowserPolicy {
  classify(intent: string): {
    mode: BrowserTaskMode;
    requiresApproval: boolean;
  } {
    const normalized = intent
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
    if (["enviar", "publicar", "excluir", "deletar", "salvar", "submeter"].some((token) => normalized.includes(token))) {
      return { mode: "write", requiresApproval: true };
    }
    if (["preencher", "rascunho", "copiar", "editar"].some((token) => normalized.includes(token))) {
      return { mode: "draft", requiresApproval: true };
    }
    return { mode: "read", requiresApproval: false };
  }
}
