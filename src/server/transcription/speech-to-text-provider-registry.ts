import { transcriptionError } from "@/server/transcription/transcription-errors";
import type {
  SpeechToTextProvider,
  SpeechToTextProviderInfo,
} from "@/server/transcription/speech-to-text-provider";
import {
  LOCAL_WHISPER_PROVIDER_ID,
  LocalWhisperSpeechToTextProvider,
} from "@/server/transcription/providers/local-whisper-provider";
import {
  OPENAI_COMPATIBLE_PROVIDER_ID,
  OpenAiCompatibleSpeechToTextProvider,
} from "@/server/transcription/providers/openai-compatible-provider";
import {
  MOCK_PROVIDER_ID,
  MockSpeechToTextProvider,
} from "@/server/transcription/providers/mock-provider";

/**
 * Provider selection in one place.
 *
 * Adding a provider means adding it here — no transcription-domain code and no
 * UI changes. The default comes from `AIDUB_STT_PROVIDER`, so a future Settings
 * page can choose per project without touching this layer.
 */

export interface SpeechToTextProviderRegistry {
  get(providerId?: string | null): SpeechToTextProvider;
  list(): SpeechToTextProviderInfo[];
  defaultProviderId(): string;
}

export const DEFAULT_PROVIDER_ID = LOCAL_WHISPER_PROVIDER_ID;

export function createProviderRegistry(
  providers: readonly SpeechToTextProvider[],
  defaultProviderId: string,
): SpeechToTextProviderRegistry {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  return {
    get(providerId) {
      const id = providerId?.trim() || defaultProviderId;
      const provider = byId.get(id);

      if (!provider) {
        throw transcriptionError("STT_PROVIDER_UNAVAILABLE", {
          details: `unknown provider ${id}`,
        });
      }

      return provider;
    },
    list() {
      return [...byId.values()].map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        capabilities: provider.capabilities,
      }));
    },
    defaultProviderId() {
      return defaultProviderId;
    },
  };
}

function configuredDefault(): string {
  const configured = process.env.AIDUB_STT_PROVIDER?.trim();

  return configured && configured.length > 0
    ? configured
    : DEFAULT_PROVIDER_ID;
}

function buildProviders(): SpeechToTextProvider[] {
  const providers: SpeechToTextProvider[] = [
    new LocalWhisperSpeechToTextProvider(),
    new OpenAiCompatibleSpeechToTextProvider(),
  ];

  // The deterministic provider is development-only and never a silent default.
  if (process.env.AIDUB_STT_PROVIDER === MOCK_PROVIDER_ID) {
    providers.push(new MockSpeechToTextProvider());
  }

  return providers;
}

export const speechToTextProviderRegistry: SpeechToTextProviderRegistry =
  createProviderRegistry(buildProviders(), configuredDefault());

export {
  LOCAL_WHISPER_PROVIDER_ID,
  OPENAI_COMPATIBLE_PROVIDER_ID,
  MOCK_PROVIDER_ID,
};
