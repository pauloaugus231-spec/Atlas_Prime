interface AudioSpeechInput {
  text: string;
  instructions?: string;
  voice?: string;
  format?: "mp3" | "wav";
}

interface AudioSpeechResult {
  audio: Buffer;
  model: string;
  voice: string;
  format: "mp3" | "wav";
}

export class OpenAiAudioSpeechService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly model = "gpt-4o-mini-tts",
    private readonly defaultVoice = "ash",
  ) {}

  async synthesize(input: AudioSpeechInput): Promise<AudioSpeechResult> {
    const text = input.text.trim();
    if (!text) {
      throw new Error("OpenAI audio speech requires non-empty text.");
    }

    const format = input.format ?? "mp3";
    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        voice: input.voice?.trim() || this.defaultVoice,
        input: text,
        response_format: format,
        ...(input.instructions?.trim() ? { instructions: input.instructions.trim() } : {}),
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`OpenAI audio speech failed (${response.status}): ${details || response.statusText}`);
    }

    return {
      audio: Buffer.from(await response.arrayBuffer()),
      model: this.model,
      voice: input.voice?.trim() || this.defaultVoice,
      format,
    };
  }
}
