function compactLines(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, 18).join("\n");
}

export class WhatsAppBriefRenderer {
  render(text: string): string {
    return compactLines(text).slice(0, 3000);
  }
}
