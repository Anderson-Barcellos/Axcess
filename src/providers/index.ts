import type { DelegateContext, ProviderHandler } from '../delegate';
import { createAnthropicProvider } from './anthropic';
import { createGoogleProvider } from './google';
import { createOpenAIProvider } from './openai';

export interface ProvidersEnvConfig {
  openaiApiKey?: string;
  anthropicApiKey?: string;
  googleApiKey?: string;
}

export function createProvidersFromEnv(config?: ProvidersEnvConfig): Record<string, ProviderHandler> {
  const openaiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  const anthropicKey = config?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  const googleKey = config?.googleApiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_AI_API_KEY;

  return {
    openai: createOpenAIProvider({ apiKey: openaiKey }),
    anthropic: createAnthropicProvider({ apiKey: anthropicKey }),
    google: createGoogleProvider({ apiKey: googleKey }),
  };
}

export function createDelegateContext(logger?: DelegateContext['logger']): DelegateContext {
  return {
    providers: createProvidersFromEnv(),
    logger,
  };
}
