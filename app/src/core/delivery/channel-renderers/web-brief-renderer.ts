export class WebBriefRenderer {
  render(profileName: string, text: string): string {
    return [`# ${profileName}`, "", text.trim()].join("\n").trim();
  }
}
