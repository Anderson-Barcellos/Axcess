import OpenAI from 'openai';
import type { ProviderHandler } from '../delegate';

export interface OpenAIProviderOptions {
  apiKey?: string;
}

function normalizeApiKey(options?: OpenAIProviderOptions): string {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY não configurada');
  }
  return apiKey;
}

export function createOpenAIProvider(options?: OpenAIProviderOptions): ProviderHandler {
  const apiKey = normalizeApiKey(options);
  const client = new OpenAI({ apiKey });

  return async ({ prompt, decision, parameters }) => {
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
  };
}
