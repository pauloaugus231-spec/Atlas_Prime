export interface AudioTranscriptionResult {
  text: string;
  model: string;
}

export interface AudioTranscriptionInput {
  audio: Uint8Array;
  filename: string;
  mimeType?: string;
  language?: string;
}

interface AudioTranscriptionResponse {
  text?: string;
}

export class OpenAiAudioTranscriptionService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = "https://api.openai.com/v1",
    private readonly model = "gpt-4o-mini-transcribe",
    private readonly timeoutMs = 120000,
  ) {}

  async transcribe(input: AudioTranscriptionInput): Promise<AudioTranscriptionResult> {
    const body = new FormData();
    const arrayBuffer = Uint8Array.from(input.audio).buffer;
    const blob = new Blob([arrayBuffer], {
      type: input.mimeType ?? "application/octet-stream",
    });

    body.append("file", blob, input.filename);
    body.append("model", this.model);
    body.append("response_format", "json");

    if (input.language?.trim()) {
      body.append("language", input.language.trim());
    }

    const response = await fetch(`${this.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`OpenAI audio transcription failed (${response.status}): ${details || response.statusText}`);
    }

    const result = (await response.json()) as AudioTranscriptionResponse;
    const text = result.text?.trim();
    if (!text) {
      throw new Error("OpenAI audio transcription returned empty text");
    }

    return {
      text,
      model: this.model,
    };
  }
}
