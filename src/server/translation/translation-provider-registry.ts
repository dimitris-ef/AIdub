import { translationError } from "@/server/translation/translation-errors";
import type {
  TranslationProvider,
  TranslationProviderInfo,
} from "@/server/translation/translation-provider";
import {
  OPENAI_COMPATIBLE_TRANSLATION_PROVIDER_ID,
  OpenAiCompatibleTranslationProvider,
} from "@/server/translation/providers/openai-compatible-provider";
import {
  MOCK_TRANSLATION_PROVIDER_ID,
  MockTranslationProvider,
} from "@/server/translation/providers/mock-provider";

/**
 * Translation provider selection in one place.
 *
 * Adding a provider — a dedicated machine-translation API, a self-hosted NMT
 * model, a GPU worker — means adding it here. No translation-domain code, no
 * persisted model, no processing-job change and no UI change. The default comes
 * from `AIDUB_TRANSLATION_PROVIDER`, so a provider id is never hard-coded
 * across the codebase and a future Settings screen can change it by writing one
 * value.
 *
 * Changing the default does **not** invalidate existing translations: each one
 * records the provider that produced it, and a person can retranslate with
 * another provider when they want to.
 */

export interface TranslationProviderRegistry {
  get(providerId?: string | null): TranslationProvider;
  list(): TranslationProviderInfo[];
  defaultProviderId(): string;
}

export const DEFAULT_TRANSLATION_PROVIDER_ID =
  OPENAI_COMPATIBLE_TRANSLATION_PROVIDER_ID;

export function createTranslationProviderRegistry(
  providers: readonly TranslationProvider[],
  defaultProviderId: string,
): TranslationProviderRegistry {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));

  return {
    get(providerId) {
      const id = providerId?.trim() || defaultProviderId;
      const provider = byId.get(id);

      if (!provider) {
        throw translationError("TRANSLATION_PROVIDER_UNAVAILABLE", {
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
  const configured = process.env.AIDUB_TRANSLATION_PROVIDER?.trim();

  return configured && configured.length > 0
    ? configured
    : DEFAULT_TRANSLATION_PROVIDER_ID;
}

function buildProviders(): TranslationProvider[] {
  const providers: TranslationProvider[] = [
    new OpenAiCompatibleTranslationProvider(),
  ];

  // The deterministic provider is development-only and never a silent default:
  // it is only registered when it has been asked for by name.
  if (process.env.AIDUB_TRANSLATION_PROVIDER === MOCK_TRANSLATION_PROVIDER_ID) {
    providers.push(new MockTranslationProvider());
  }

  return providers;
}

export const translationProviderRegistry: TranslationProviderRegistry =
  createTranslationProviderRegistry(buildProviders(), configuredDefault());

export {
  OPENAI_COMPATIBLE_TRANSLATION_PROVIDER_ID,
  MOCK_TRANSLATION_PROVIDER_ID,
};
