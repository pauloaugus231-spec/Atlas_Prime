export interface VoiceActionConfirmationResult {
  decision: "confirm" | "cancel" | "unknown";
  action?: "send" | "delete" | "schedule" | "publish";
}

export class VoiceActionConfirmationService {
  parse(text: string): VoiceActionConfirmationResult {
    const normalized = text
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase()
      .trim();
    if (!normalized) {
      return { decision: "unknown" };
    }
    if (["cancelar", "cancela", "nao enviar", "não enviar", "nao", "não"].some((token) => normalized.includes(token))) {
      return { decision: "cancel" };
    }
    if (normalized.includes("confirmo") || normalized.includes("pode enviar") || normalized.includes("aprovado")) {
      if (normalized.includes("excluir") || normalized.includes("apagar")) {
        return { decision: "confirm", action: "delete" };
      }
      if (normalized.includes("agendar") || normalized.includes("marcar")) {
        return { decision: "confirm", action: "schedule" };
      }
      if (normalized.includes("publicar")) {
        return { decision: "confirm", action: "publish" };
      }
      return { decision: "confirm", action: "send" };
    }
    return { decision: "unknown" };
  }
}
