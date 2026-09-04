import { ttsError } from "@/server/tts/tts-errors";
import type {
  TtsProvider,
  TtsProviderDescriptor,
} from "@/server/tts/tts-provider";
import {
  LOCAL_VITS_PROVIDER_ID,
  LocalVitsTtsProvider,
} from "@/server/tts/providers/local-vits-provider";
import {
  MOCK_TTS_PROVIDER_ID,
  MockTtsProvider,
} from "@/server/tts/providers/mock-provider";

/**
 * Speech provider selection in one place.
 *
 * Adding a provider — a hosted synthesis API, another self-hosted model, a GPU
 * worker — means adding it here. No TTS-domain code, no persisted model, no
 * processing-job change and no UI change. The default comes from
 * `AIDUB_TTS_PROVIDER`, so a provider id is never hard-coded across the
 * codebase and a future Settings screen can change it by writing one value.
 *
 * Changing the default does **not** invalidate existing audio: every generated
 * record and every voice assignment names the provider it belongs to, and a
 * person can reassign and regenerate with another provider when they want to.
 */

export interface TtsProviderRegistry {
  get(providerId?: string | null): TtsProvider;
  list(): TtsProviderDescriptor[];
  defaultProviderId(): string;
}

export const DEFAULT_TTS_PROVIDER_ID = LOCAL_VITS_PROVIDER_ID;

export function createTtsProviderRegistry(
  providers: readonly TtsProvider[],
  defaultProviderId: string,
): TtsProviderRegistry {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  return {
    get(providerId) {
      const id = providerId?.trim() || defaultProviderId;
      const provider = byId.get(id);

      if (!provider) {
        throw ttsError("TTS_PROVIDER_UNAVAILABLE", {
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
  const configured = process.env.AIDUB_TTS_PROVIDER?.trim();

  return configured && configured.length > 0
    ? configured
    : DEFAULT_TTS_PROVIDER_ID;
}

function buildProviders(): TtsProvider[] {
  const providers: TtsProvider[] = [new LocalVitsTtsProvider()];

  // The deterministic provider is development-only and never a silent default:
  // it is registered only when it has been asked for by name, so a
  // misconfigured real provider fails loudly instead of quietly producing
  // tones that look like dubbed speech.
  if (process.env.AIDUB_TTS_PROVIDER === MOCK_TTS_PROVIDER_ID) {
    providers.push(new MockTtsProvider());
  }

  return providers;
}

export const ttsProviderRegistry: TtsProviderRegistry = createTtsProviderRegistry(
  buildProviders(),
  configuredDefault(),
);

export { LOCAL_VITS_PROVIDER_ID, MOCK_TTS_PROVIDER_ID };
