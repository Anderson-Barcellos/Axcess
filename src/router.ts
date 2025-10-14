import { loadModelsConfig, loadPoliciesConfig, ModelInfo } from './config.js';

export interface RouteCapsRequest {
  maxOutputTokens?: number;
}

export type RequestDomain = 'code' | 'creative' | 'default';

export interface RouteMetadata {
  language?: string;
  tier?: string;
  domain?: RequestDomain;
  temperature?: number;
}

export interface RouteRequest {
  prompt: string;
  forceModel?: string;
  caps?: RouteCapsRequest;
  metadata?: RouteMetadata;
}

export interface RouteDecision {
  alias: string;
  modelId: string;
  provider: string;
  model: string;
}

export interface RouteParameters {
  max_output_tokens: number;
  temperature: number;
}

export interface RouteUsage {
  estimated_input_tokens: number;
}

export interface RouteResult {
  decision: RouteDecision;
  parameters: RouteParameters;
  rationale: string[];
  fallbacks: RouteDecision[];
  usage: RouteUsage;
  meta: {
    target_max_output_tokens: number;
  };
}

const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeLanguageCode(language?: string): string | undefined {
  if (!language) {
    return undefined;
  }
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith('pt')) {
    return 'pt';
  }
  if (normalized.startsWith('en')) {
    return 'en';
  }
  if (normalized.startsWith('es')) {
    return 'es';
  }
  return normalized;
}

function detectLanguage(text: string): string | undefined {
  const sample = text.slice(0, 512).toLowerCase();
  if (!sample) {
    return undefined;
  }

  let scorePt = 0;
  let scoreEs = 0;
  let scoreEn = 0;

  if (/[ãõçáéíóúâêôà]/u.test(sample)) {
    scorePt += 2;
  }
  if (/[ñáéíóúü¿¡]/u.test(sample)) {
    scoreEs += 2;
  }
  if (/\b(the|and|you|with|for|this|that)\b/u.test(sample)) {
    scoreEn += 2;
  }
  if (/\bque\b/u.test(sample)) {
    scorePt += 1;
    scoreEs += 1;
  }
  if (/\bnão\b|\bpois\b|\bassim\b/u.test(sample)) {
    scorePt += 1;
  }
  if (/\busted\b|\bpara\b|\bcuando\b/u.test(sample)) {
    scoreEs += 1;
  }
  if (/\bwill\b|\bshould\b|\bcan\b/u.test(sample)) {
    scoreEn += 1;
  }

  const scores: Array<{ code: string; score: number }> = [
    { code: 'pt', score: scorePt },
    { code: 'es', score: scoreEs },
    { code: 'en', score: scoreEn },
  ];

  scores.sort((a, b) => b.score - a.score);
  if (scores[0].score === 0 || (scores[0].score === scores[1].score)) {
    return undefined;
  }
  return scores[0].code;
}

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 3));
}

interface ResolvedModel {
  decision: RouteDecision;
  modelInfo: ModelInfo;
}

function resolveModel(target: string, rationale: string[]): ResolvedModel {
  const modelsConfig = loadModelsConfig();
  const modelKeyFromAlias = modelsConfig.aliases[target];
  if (modelKeyFromAlias) {
    const modelInfo = modelsConfig.models[modelKeyFromAlias];
    if (!modelInfo) {
      throw new Error(`Alias "${target}" aponta para modelo inexistente "${modelKeyFromAlias}"`);
    }
    rationale.push(`Alias "${target}" resolve para ${modelInfo.provider}/${modelInfo.model}.`);
    return {
      decision: {
        alias: target,
        modelId: modelKeyFromAlias,
        provider: modelInfo.provider,
        model: modelInfo.model,
      },
      modelInfo,
    };
  }

  const modelInfo = modelsConfig.models[target];
  if (modelInfo) {
    const aliasEntry = Object.entries(modelsConfig.aliases).find(([, modelId]) => modelId === target);
    const alias = aliasEntry ? aliasEntry[0] : target;
    rationale.push(`Modelo "${target}" será usado diretamente (${modelInfo.provider}/${modelInfo.model}).`);
    return {
      decision: {
        alias,
        modelId: target,
        provider: modelInfo.provider,
        model: modelInfo.model,
      },
      modelInfo,
    };
  }

  throw new Error(`Modelo ou alias desconhecido: ${target}`);
}

function selectAliasByBucket(estimatedTokens: number): string | undefined {
  const { tokenBuckets } = loadPoliciesConfig().routing;
  for (const bucket of tokenBuckets) {
    const min = bucket.minPromptTokens ?? 0;
    const max = bucket.maxPromptTokens ?? Number.POSITIVE_INFINITY;
    if (estimatedTokens >= min && estimatedTokens < max) {
      return bucket.alias;
    }
  }
  return undefined;
}

function applyCapLimits(target: number, modelInfo: ModelInfo): number {
  const values: number[] = [target, modelInfo.cap.default, modelInfo.max_output_tokens];
  if (typeof modelInfo.cap.hard === 'number') {
    values.push(modelInfo.cap.hard);
  }
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0);
  const candidate = Math.min(...filtered);
  return Math.max(1, Math.floor(candidate));
}

export function routeRequest(request: RouteRequest): RouteResult {
  if (!request || typeof request.prompt !== 'string') {
    throw new Error('routeRequest: prompt ausente');
  }

  const modelsConfig = loadModelsConfig();
  const policies = loadPoliciesConfig();
  const rationale: string[] = [];

  const estimatedTokens = estimateTokens(request.prompt);
  rationale.push(`Estimativa de tokens de entrada: ~${estimatedTokens}.`);

  const metadata = request.metadata ?? {};
  const normalizedLanguage = normalizeLanguageCode(metadata.language) ?? detectLanguage(request.prompt);
  if (normalizedLanguage) {
    rationale.push(`Idioma considerado: ${normalizedLanguage}.`);
  }

  let selectedAlias = policies.routing.defaultAlias;
  rationale.push(`Alias padrão da política: ${selectedAlias}.`);

  if (request.forceModel) {
    rationale.push(`forceModel recebido: ${request.forceModel}.`);
    const resolved = resolveModel(request.forceModel, rationale);
    const policyCap = resolvePolicyCap(metadata.tier, rationale);
    const targetCap = applyRequestCaps(policyCap, request.caps, rationale);
    const maxOutputTokens = applyCapLimits(targetCap, resolved.modelInfo);
    const temperature = resolveTemperature(metadata, resolved.modelInfo, rationale);

    const fallbackDecisions = resolveFallbacks(resolved.decision.alias, rationale);

    return {
      decision: resolved.decision,
      parameters: {
        max_output_tokens: maxOutputTokens,
        temperature,
      },
      rationale,
      fallbacks: fallbackDecisions,
      usage: {
        estimated_input_tokens: estimatedTokens,
      },
      meta: {
        target_max_output_tokens: targetCap,
      },
    };
  }

  const bucketAlias = selectAliasByBucket(estimatedTokens);
  if (bucketAlias) {
    selectedAlias = bucketAlias;
    rationale.push(`Bucket de tokens selecionou alias ${bucketAlias}.`);
  }

  let temperatureOverride: number | undefined;
  if (normalizedLanguage) {
    const languagePolicy = policies.routing.languageHeuristics[normalizedLanguage];
    if (languagePolicy) {
      if (languagePolicy.alias && languagePolicy.alias !== selectedAlias) {
        selectedAlias = languagePolicy.alias;
        rationale.push(`Heurística de idioma ajustou alias para ${selectedAlias}.`);
      }
      if (typeof languagePolicy.temperature === 'number') {
        temperatureOverride = languagePolicy.temperature;
        rationale.push(`Heurística de idioma sugeriu temperatura ${languagePolicy.temperature}.`);
      }
    }
  }

  const resolved = resolveModel(selectedAlias, rationale);
  const policyCap = resolvePolicyCap(metadata.tier, rationale);
  const targetCap = applyRequestCaps(policyCap, request.caps, rationale);
  const maxOutputTokens = applyCapLimits(targetCap, resolved.modelInfo);
  const temperature = resolveTemperature(metadata, resolved.modelInfo, rationale, temperatureOverride);
  const fallbacks = resolveFallbacks(resolved.decision.alias, rationale);

  return {
    decision: resolved.decision,
    parameters: {
      max_output_tokens: maxOutputTokens,
      temperature,
    },
    rationale,
    fallbacks,
    usage: {
      estimated_input_tokens: estimatedTokens,
    },
    meta: {
      target_max_output_tokens: targetCap,
    },
  };
}

function resolvePolicyCap(tier: string | undefined, rationale: string[]): number {
  const policies = loadPoliciesConfig();
  let limit = policies.caps.default;
  if (tier) {
    const normalizedTier = tier.trim().toLowerCase();
    const tierCap = policies.caps.tiers?.[normalizedTier];
    if (tierCap) {
      rationale.push(`Cap de tier "${normalizedTier}": ${tierCap}.`);
      limit = tierCap;
    } else {
      rationale.push(`Tier "${normalizedTier}" sem cap específico, usando padrão ${limit}.`);
    }
  } else {
    rationale.push(`Cap padrão aplicado: ${limit}.`);
  }
  return limit;
}

function applyRequestCaps(policyCap: number, caps: RouteCapsRequest | undefined, rationale: string[]): number {
  let target = policyCap;
  if (caps?.maxOutputTokens && caps.maxOutputTokens > 0) {
    target = Math.min(target, caps.maxOutputTokens);
    rationale.push(`Cap solicitado na requisição: ${caps.maxOutputTokens}.`);
  }
  return target;
}

function resolveTemperature(
  metadata: RouteMetadata,
  modelInfo: ModelInfo,
  rationale: string[],
  languageOverride?: number,
): number {
  const policies = loadPoliciesConfig();
  let temperature = typeof modelInfo.temperature === 'number' ? modelInfo.temperature : policies.temperatures.default;
  rationale.push(`Temperatura base do modelo/política: ${temperature}.`);

  if (typeof languageOverride === 'number') {
    temperature = languageOverride;
    rationale.push(`Temperatura ajustada pela heurística de idioma: ${temperature}.`);
  }

  if (metadata.domain) {
    const domainTemp = (policies.temperatures as Record<string, number | undefined>)[metadata.domain];
    if (typeof domainTemp === 'number') {
      temperature = domainTemp;
      rationale.push(`Temperatura ajustada pelo domínio "${metadata.domain}": ${temperature}.`);
    }
  }

  if (typeof metadata.temperature === 'number') {
    temperature = metadata.temperature;
    rationale.push(`Temperatura explicitamente definida na requisição: ${temperature}.`);
  }

  temperature = clamp(temperature, MIN_TEMPERATURE, MAX_TEMPERATURE);
  rationale.push(`Temperatura final após clamp: ${temperature}.`);
  return temperature;
}

function resolveFallbacks(primaryAlias: string, rationale: string[]): RouteDecision[] {
  const policies = loadPoliciesConfig();
  const fallbacks = policies.routing.fallbacks[primaryAlias] ?? [];
  const decisions: RouteDecision[] = [];
  const seen = new Set<string>([primaryAlias]);

  for (const alias of fallbacks) {
    if (seen.has(alias)) {
      continue;
    }
    try {
      const resolved = resolveModel(alias, rationale);
      decisions.push(resolved.decision);
      seen.add(alias);
    } catch (error) {
      rationale.push(`Fallback ignorado "${alias}": ${(error as Error).message}.`);
    }
  }

  if (decisions.length) {
    rationale.push(`Fallbacks disponíveis: ${decisions.map((item) => item.alias).join(', ')}.`);
  } else {
    rationale.push('Nenhum fallback configurado para o alias selecionado.');
  }

  return decisions;
}

export function computeMaxTokensForModel(targetCap: number, modelId: string): number {
  const modelsConfig = loadModelsConfig();
  const modelInfo = modelsConfig.models[modelId];
  if (!modelInfo) {
    throw new Error(`Modelo desconhecido: ${modelId}`);
  }
  return applyCapLimits(targetCap, modelInfo);
}
