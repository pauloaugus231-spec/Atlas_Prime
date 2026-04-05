import type { MediaConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import type { PexelsVideoSuggestion } from "./pexels.js";

export class KlingMediaService {
  constructor(
    private readonly config: MediaConfig,
    private readonly logger: Logger,
  ) {}

  isEnabled(): boolean {
    return this.config.klingEnabled
      && Boolean(this.config.klingAccessKey)
      && Boolean(this.config.klingSecretKey);
  }

  supportsDirectGeneration(): boolean {
    return this.isEnabled() && this.config.klingDirectGenerationEnabled;
  }

  async generateVerticalVideo(_input: {
    prompt: string;
    durationSeconds: number;
  }): Promise<PexelsVideoSuggestion> {
    if (!this.isEnabled()) {
      throw new Error("Kling não está configurado.");
    }
    if (!this.supportsDirectGeneration()) {
      this.logger.info("Kling direct generation is configured but disabled", {
        directGenerationEnabled: this.config.klingDirectGenerationEnabled,
      });
      throw new Error(
        "Kling está configurado, mas a chamada direta ainda está desativada até validar o contrato oficial desse access key/secret.",
      );
    }

    throw new Error("Kling direct generation ainda não foi implementado no runtime.");
  }
}
