import Anthropic, { APIError as AnthropicAPIError } from '@anthropic-ai/sdk';
import type { ProviderHandler } from '../delegate';

export interface AnthropicProviderOptions {
  apiKey?: string;
}

function buildAnthropicClient(apiKey?: string): Anthropic | null {
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new Anthropic({ apiKey });
}

function normalizeAnthropicError(error: unknown): Error {
  if (error instanceof AnthropicAPIError) {
    if (error.status === 401 || error.status === 403) {
      return new Error('anthropic: falha de autenticação. Confere ANTHROPIC_API_KEY e escopos.');
    }
    if (error.status === 408) {
      return new Error('anthropic: tempo limite excedido. Bora tentar o fallback.');
    }
    if (error.status === 429) {
      return new Error('anthropic: limite de requisições atingido. Segura um pouco e tenta de novo.');
    }
    return new Error(`anthropic: ${error.message}`);
  }

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
      return new Error('anthropic: conexão expirou. Vamos chamar o próximo da fila.');
    }
    return new Error(`anthropic: ${error.message}`);
  }

  return new Error(`anthropic: falha inesperada (${String(error)})`);
}

export function createAnthropicProvider(options?: AnthropicProviderOptions): ProviderHandler {
  const client = buildAnthropicClient(options?.apiKey);

  return async ({ prompt, decision, parameters }) => {
    if (!client) {
      throw new Error('anthropic: chave de API não configurada. Define ANTHROPIC_API_KEY.');
    }

    try {
      const response = await client.responses.create({
        model: decision.model,
        max_output_tokens: parameters.max_output_tokens,
        temperature: parameters.temperature,
        input: prompt,
      });

      const outputText = typeof response.output_text === 'string'
        ? response.output_text
        : Array.isArray(response.output)
          ? response.output
              .map((item) => {
                if (item.type === 'output_text' && typeof item.text === 'string') {
                  return item.text;
                }
                return '';
              })
              .join('')
          : '';

      return {
        outputText,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          totalTokens: response.usage?.total_tokens,
        },
        raw: response,
      };
    } catch (error) {
      throw normalizeAnthropicError(error);
    }
  };
}
