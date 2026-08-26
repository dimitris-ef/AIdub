import { diarizationError } from "@/server/diarization/diarization-errors";
import type {
  SpeakerDiarizationProvider,
  SpeakerDiarizationProviderInfo,
} from "@/server/diarization/speaker-diarization-provider";
import {
  LOCAL_PYANNOTE_PROVIDER_ID,
  LocalPyannoteDiarizationProvider,
} from "@/server/diarization/providers/local-pyannote-provider";
import {
  MOCK_DIARIZATION_PROVIDER_ID,
  MockSpeakerDiarizationProvider,
} from "@/server/diarization/providers/mock-provider";

/**
 * Diarization provider selection in one place.
 *
 * Adding a provider — a Python pyannote worker, a GPU service, a hosted API —
 * means adding it here. No diarization-domain code, no persisted model and no
 * UI changes. The default comes from `AIDUB_DIARIZATION_PROVIDER`, so the
 * provider name is never hard-coded across the codebase.
 */

export interface SpeakerDiarizationProviderRegistry {
  get(providerId?: string | null): SpeakerDiarizationProvider;
  list(): SpeakerDiarizationProviderInfo[];
  defaultProviderId(): string;
}

export const DEFAULT_DIARIZATION_PROVIDER_ID = LOCAL_PYANNOTE_PROVIDER_ID;

export function createDiarizationProviderRegistry(
  providers: readonly SpeakerDiarizationProvider[],
  defaultProviderId: string,
): SpeakerDiarizationProviderRegistry {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  return {
    get(providerId) {
      const id = providerId?.trim() || defaultProviderId;
      const provider = byId.get(id);

      if (!provider) {
        throw diarizationError("DIARIZATION_PROVIDER_UNAVAILABLE", {
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
  const configured = process.env.AIDUB_DIARIZATION_PROVIDER?.trim();

  return configured && configured.length > 0
    ? configured
    : DEFAULT_DIARIZATION_PROVIDER_ID;
}

function buildProviders(): SpeakerDiarizationProvider[] {
  const providers: SpeakerDiarizationProvider[] = [
    new LocalPyannoteDiarizationProvider(),
  ];

  // The deterministic provider is development-only and never a silent default.
  if (process.env.AIDUB_DIARIZATION_PROVIDER === MOCK_DIARIZATION_PROVIDER_ID) {
    providers.push(new MockSpeakerDiarizationProvider());
  }

  return providers;
}

export const speakerDiarizationProviderRegistry: SpeakerDiarizationProviderRegistry =
  createDiarizationProviderRegistry(buildProviders(), configuredDefault());

export { LOCAL_PYANNOTE_PROVIDER_ID, MOCK_DIARIZATION_PROVIDER_ID };
