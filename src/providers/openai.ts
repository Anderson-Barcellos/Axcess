import OpenAI, { APIError as OpenAIAPIError } from 'openai';
import type { ProviderHandler } from '../delegate.js';

export interface OpenAIProviderOptions {
  apiKey?: string;
}

function buildOpenAIClient(apiKey?: string): OpenAI | null {
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new OpenAI({ apiKey });
}

function normalizeOpenAIError(error: unknown): Error {
  if (error instanceof OpenAIAPIError) {
    if (error.status === 401 || error.status === 403) {
      return new Error('openai: falha de autenticação. Confere OPENAI_API_KEY e permissões.');
    }
    if (error.status === 408) {
      return new Error('openai: tempo limite excedido ao gerar resposta. Tenta de novo daqui a pouco.');
    }
    if (error.status === 429) {
      return new Error('openai: limite de requisições atingido. Aguarda um pouco antes de tentar de novo.');
    }
    return new Error(`openai: ${error.message}`);
  }

  if (error instanceof Error) {
    const timeoutCodes = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);
    const networkCodes = new Set(['ECONNRESET', 'ECONNREFUSED']);
    const code = (error as NodeJS.ErrnoException).code;
    if (code && timeoutCodes.has(code)) {
      return new Error('openai: tempo limite na conexão. Tenta novamente em instantes.');
    }
    if (code && networkCodes.has(code)) {
      return new Error('openai: conexão com a API falhou. Dá uma conferida e tenta outra rota.');
    }
    return new Error(`openai: ${error.message}`);
  }

  return new Error(`openai: falha inesperada (${String(error)})`);
}

export function createOpenAIProvider(options?: OpenAIProviderOptions): ProviderHandler {
  const client = buildOpenAIClient(options?.apiKey);

  return async ({ prompt, decision, parameters }) => {
    if (!client) {
      throw new Error('openai: chave de API não configurada. Define OPENAI_API_KEY.');
    }

    try {
      const response = await client.responses.create({
        model: decision.model,
        input: prompt,
        temperature: parameters.temperature,
        max_output_tokens: parameters.max_output_tokens,
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
      throw normalizeOpenAIError(error);
    }
  };
}
