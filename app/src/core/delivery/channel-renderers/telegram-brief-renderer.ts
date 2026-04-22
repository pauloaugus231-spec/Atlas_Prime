export class TelegramBriefRenderer {
  render(text: string): string {
    return text.trim().slice(0, 3900);
  }
}
