import { loadModelsConfig } from './config.js';
import { computeMaxTokensForModel, routeRequest, RouteDecision, RouteParameters, RouteRequest, RouteResult } from './router.js';

export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface ProviderResponse {
  outputText: string;
  usage?: ProviderUsage;
  raw?: unknown;
}

export interface ProviderCallArgs {
  prompt: string;
  decision: RouteDecision;
  parameters: RouteParameters;
  request: RouteRequest;
}

export type ProviderHandler = (args: ProviderCallArgs) => Promise<ProviderResponse>;

export interface DelegateContext {
  providers: Record<string, ProviderHandler>;
  logger?: {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}

export interface AttemptLog {
  alias: string;
  provider: string;
  model: string;
  success: boolean;
  error?: string;
}

export interface DelegateResult {
  text: string;
  decision: RouteDecision;
  parameters: RouteParameters;
  rationale: string[];
  usage: {
    estimated_input_tokens: number;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
  cost: {
    currency: string;
    input: number;
    output: number;
    total: number;
  };
  meta: {
    rawResponse?: unknown;
    fallback_used: boolean;
    attempts: AttemptLog[];
  };
}

function sanitizeTokens(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return undefined;
  }
  return Math.max(0, Math.round(value));
}

export async function run(request: RouteRequest, context: DelegateContext): Promise<DelegateResult> {
  if (!context?.providers) {
    throw new Error('delegate.run: nenhum provider registrado');
  }

  const routing: RouteResult = routeRequest(request);
  const modelsConfig = loadModelsConfig();
  const attempts: AttemptLog[] = [];
  const candidates: RouteDecision[] = [routing.decision, ...routing.fallbacks];
  const errors: string[] = [];
  const logger = context.logger;

  for (let index = 0; index < candidates.length; index += 1) {
    const decision = candidates[index];
    const providerHandler = context.providers[decision.provider];
    const attemptEntry: AttemptLog = {
      alias: decision.alias,
      provider: decision.provider,
      model: decision.model,
      success: false,
    };

    if (!providerHandler) {
      const message = `Provider "${decision.provider}" não registrado.`;
      attemptEntry.error = message;
      attempts.push(attemptEntry);
      errors.push(message);
      logger?.warn?.(message);
      continue;
    }

    const cappedMaxTokens = computeMaxTokensForModel(routing.meta.target_max_output_tokens, decision.modelId);
    const parameters: RouteParameters = {
      max_output_tokens: cappedMaxTokens,
      temperature: routing.parameters.temperature,
    };

    try {
      const response = await providerHandler({
        prompt: request.prompt,
        decision,
        parameters,
        request,
      });

      const providerUsage = response.usage ?? {};
      const estimatedInputTokens = routing.usage.estimated_input_tokens;
      const sanitizedInput = sanitizeTokens(providerUsage.inputTokens);
      const sanitizedOutput = sanitizeTokens(providerUsage.outputTokens);
      const sanitizedTotal = sanitizeTokens(providerUsage.totalTokens);

      const onlyTotalProvided =
        sanitizedTotal !== undefined && sanitizedInput === undefined && sanitizedOutput === undefined;

      const tokenFallbackNotes: string[] = [];
      let inputTokens = sanitizedInput ?? estimatedInputTokens;
      let outputTokens = sanitizedOutput ?? 0;

      if (onlyTotalProvided) {
        inputTokens = sanitizedTotal!;
        outputTokens = 0;
        const message =
          'Provider informou apenas totalTokens; assumindo total como input_tokens e output_tokens=0.';
        tokenFallbackNotes.push(message);
        logger?.debug?.(
          'delegate.run: somente totalTokens fornecido; adotando input=%d e output=%d para cálculo de custos.',
          inputTokens,
          outputTokens,
        );
      } else {
        if (sanitizedInput === undefined && sanitizedTotal !== undefined) {
          inputTokens = Math.max(sanitizedTotal - outputTokens, 0);
        }

        if (sanitizedOutput === undefined && sanitizedTotal !== undefined) {
          outputTokens = Math.max(sanitizedTotal - inputTokens, 0);
        }
      }

      const totalTokens = sanitizedTotal ?? inputTokens + outputTokens;

      const modelInfo = modelsConfig.models[decision.modelId];
      if (!modelInfo) {
        throw new Error(`Modelo ${decision.modelId} não encontrado na configuração.`);
      }

      const currency = modelInfo.pricing.currency ?? 'USD';
      const inputCost = inputTokens * modelInfo.pricing.input;
      const outputCost = outputTokens * modelInfo.pricing.output;
      const totalCost = inputCost + outputCost;

      attemptEntry.success = true;
      attempts.push(attemptEntry);

      const fallbackUsed = index > 0;
      const rationale = [...routing.rationale, ...tokenFallbackNotes];
      if (fallbackUsed) {
        rationale.push(`Fallback usado: ${decision.alias}.`);
      }

      logger?.info?.(`delegate.run: chamada bem sucedida com ${decision.provider}/${decision.model}.`);

      return {
        text: response.outputText,
        decision,
        parameters,
        rationale,
        usage: {
          estimated_input_tokens: estimatedInputTokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens,
        },
        cost: {
          currency,
          input: inputCost,
          output: outputCost,
          total: totalCost,
        },
        meta: {
          rawResponse: response.raw,
          fallback_used: fallbackUsed,
          attempts,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptEntry.error = message;
      attempts.push(attemptEntry);
      errors.push(message);
      logger?.error?.(`delegate.run: erro ao chamar ${decision.provider}/${decision.model}: ${message}`);
    }
  }

  const errorMessage = `delegate.run: todas as tentativas falharam (${errors.join('; ')}).`;
  throw new Error(errorMessage);
}
