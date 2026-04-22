function formatSubject(profileName: string, now = new Date()): string {
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  }).format(now);
  return `Atlas • ${profileName} • ${date}`;
}

export class EmailBriefRenderer {
  render(profileName: string, text: string): { subject: string; body: string } {
    const cleaned = text.trim();
    return {
      subject: formatSubject(profileName),
      body: [
        `Resumo ${profileName}`,
        "",
        cleaned,
      ].join("\n").trim(),
    };
  }
}
