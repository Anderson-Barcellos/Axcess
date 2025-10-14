import { GenerativeServiceClient, type GenerateContentResponse } from '@google-ai/generativelanguage';
import { GoogleAuth } from 'google-auth-library';
import type { ProviderHandler } from '../delegate';

export interface GoogleProviderOptions {
  apiKey?: string;
}

type GoogleClientPromise = Promise<GenerativeServiceClient>;

function ensureModelName(model: string): string {
  return model.startsWith('models/') ? model : `models/${model}`;
}

function extractGoogleText(response: GenerateContentResponse): string {
  const parts: string[] = [];
  for (const candidate of response.candidates ?? []) {
    const candidateParts = candidate.content?.parts ?? [];
    for (const part of candidateParts) {
      if ('text' in part && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  return parts.join('');
}

function normalizeGoogleError(error: unknown): Error {
  const numericCode = typeof (error as { code?: number }).code === 'number' ? (error as { code?: number }).code : undefined;
  const httpStatus = typeof (error as { status?: number }).status === 'number' ? (error as { status?: number }).status : undefined;
  const grpcStatus = typeof (error as { status?: string }).status === 'string' ? (error as { status?: string }).status : undefined;
  const statusMessage = typeof (error as { statusMessage?: string }).statusMessage === 'string'
    ? (error as { statusMessage?: string }).statusMessage
    : undefined;

  const baseMessage = error instanceof Error ? error.message : String(error);

  if (baseMessage.trim().toLowerCase().startsWith('google:')) {
    return new Error(baseMessage);
  }

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    grpcStatus === 'UNAUTHENTICATED' ||
    grpcStatus === 'PERMISSION_DENIED' ||
    numericCode === 7 ||
    numericCode === 16
  ) {
    return new Error('google: falha de autenticação. Confere GOOGLE_API_KEY e habilita o Gemini.');
  }

  if (
    httpStatus === 408 ||
    httpStatus === 504 ||
    grpcStatus === 'DEADLINE_EXCEEDED' ||
    grpcStatus === 'UNAVAILABLE' ||
    numericCode === 4 ||
    numericCode === 14
  ) {
    return new Error('google: tempo limite ou indisponibilidade. Chamando fallback.');
  }

  if (httpStatus === 429 || grpcStatus === 'RESOURCE_EXHAUSTED' || numericCode === 8) {
    return new Error('google: cota ou rate limit batendo forte. Espera um pouco ou troca de provedor.');
  }

  if (error instanceof Error) {
    const errno = (error as NodeJS.ErrnoException).code;
    if (errno === 'ETIMEDOUT' || errno === 'ESOCKETTIMEDOUT') {
      return new Error('google: conexão expirou. Partiu fallback.');
    }
    if (errno === 'ECONNREFUSED' || errno === 'ECONNRESET') {
      return new Error('google: conexão com a API falhou. Tenta outro provider rapidinho.');
    }
  }

  if (statusMessage && statusMessage.trim() !== '') {
    return new Error(`google: ${statusMessage}`);
  }

  return new Error(`google: ${baseMessage}`);
}

async function createGoogleClient(apiKey?: string): GoogleClientPromise {
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    throw new Error('google: chave de API não configurada. Define GOOGLE_API_KEY.');
  }

  const authClient = await new GoogleAuth().fromAPIKey(trimmed);
  return new GenerativeServiceClient({ authClient });
}

export function createGoogleProvider(options?: GoogleProviderOptions): ProviderHandler {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_AI_API_KEY;
  const clientPromise: GoogleClientPromise | null = apiKey && apiKey.trim() !== ''
    ? createGoogleClient(apiKey).catch((error) => {
        throw normalizeGoogleError(error);
      })
    : null;

  return async ({ prompt, decision, parameters }) => {
    if (!clientPromise) {
      throw new Error('google: chave de API não configurada. Define GOOGLE_API_KEY.');
    }

    let client: GenerativeServiceClient;
    try {
      client = await clientPromise;
    } catch (error) {
      throw normalizeGoogleError(error);
    }

    const generationConfig: { maxOutputTokens?: number; temperature?: number } = {};
    if (typeof parameters.max_output_tokens === 'number') {
      generationConfig.maxOutputTokens = parameters.max_output_tokens;
    }
    if (typeof parameters.temperature === 'number') {
      generationConfig.temperature = parameters.temperature;
    }

    const request: Parameters<GenerativeServiceClient['generateContent']>[0] = {
      model: ensureModelName(decision.model),
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: prompt,
            },
          ],
        },
      ],
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    };

    try {
      const [response] = await client.generateContent(request);
      const outputText = extractGoogleText(response) ?? '';
      const usage = response.usageMetadata;

      return {
        outputText,
        usage: usage
          ? {
              inputTokens: usage.promptTokenCount,
              outputTokens: usage.candidatesTokenCount,
              totalTokens: usage.totalTokenCount,
            }
          : undefined,
        raw: response,
      };
    } catch (error) {
      throw normalizeGoogleError(error);
    }
  };
}
