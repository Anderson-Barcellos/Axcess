import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface ModelPricing {
  currency?: string;
  input: number;
  output: number;
}

export interface ModelCap {
  default: number;
  hard?: number;
}

export interface ModelInfo {
  provider: string;
  model: string;
  max_output_tokens: number;
  temperature?: number;
  cap: ModelCap;
  pricing: ModelPricing;
}

export interface ModelsConfig {
  aliases: Record<string, string>;
  models: Record<string, ModelInfo>;
}

export interface LanguageHeuristic {
  alias?: string;
  temperature?: number;
}

export interface TokenBucketRule {
  alias: string;
  minPromptTokens?: number;
  maxPromptTokens?: number;
}

export interface RoutingPolicy {
  defaultAlias: string;
  languageHeuristics: Record<string, LanguageHeuristic>;
  tokenBuckets: TokenBucketRule[];
  fallbacks: Record<string, string[]>;
}

export interface CapsPolicy {
  default: number;
  tiers?: Record<string, number>;
}

export interface TemperaturesPolicy {
  default: number;
  code?: number;
  creative?: number;
}

export interface PoliciesConfig {
  routing: RoutingPolicy;
  caps: CapsPolicy;
  temperatures: TemperaturesPolicy;
}

let modelsCache: ModelsConfig | null = null;
let policiesCache: PoliciesConfig | null = null;

function getConfPath(filename: string): string {
  return path.resolve(__dirname, '..', 'conf', filename);
}

function assertNumber(value: unknown, message: string): asserts value is number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(message);
  }
}

function assertObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
}

export function loadModelsConfig(): ModelsConfig {
  if (modelsCache) {
    return modelsCache;
  }

  const raw = readFileSync(getConfPath('models.json'), 'utf-8');
  const parsed = JSON.parse(raw) as Partial<ModelsConfig>;

  if (!parsed.aliases || typeof parsed.aliases !== 'object') {
    throw new Error('models.json: missing aliases map');
  }

  if (!parsed.models || typeof parsed.models !== 'object') {
    throw new Error('models.json: missing models map');
  }

  const aliases: Record<string, string> = {};
  for (const [alias, modelKey] of Object.entries(parsed.aliases)) {
    if (typeof alias !== 'string' || alias.trim() === '') {
      throw new Error(`models.json: invalid alias name "${alias}"`);
    }
    if (typeof modelKey !== 'string' || modelKey.trim() === '') {
      throw new Error(`models.json: alias "${alias}" has invalid target`);
    }
    aliases[alias] = modelKey;
  }

  const models: Record<string, ModelInfo> = {};
  for (const [modelKey, value] of Object.entries(parsed.models as Record<string, unknown>)) {
    assertObject(value, `models.json: model "${modelKey}" must be an object`);

    const provider = value.provider;
    const model = value.model;
    const maxOutputTokens = value.max_output_tokens;
    const temperature = value.temperature;
    const cap = value.cap;
    const pricing = value.pricing;

    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new Error(`models.json: model "${modelKey}" missing provider`);
    }

    if (typeof model !== 'string' || model.trim() === '') {
      throw new Error(`models.json: model "${modelKey}" missing model identifier`);
    }

    assertNumber(maxOutputTokens, `models.json: model "${modelKey}" max_output_tokens must be a number`);

    if (temperature !== undefined) {
      assertNumber(temperature, `models.json: model "${modelKey}" temperature must be a number`);
    }

    assertObject(cap, `models.json: model "${modelKey}" cap must be an object`);
    assertNumber((cap as Record<string, unknown>).default, `models.json: model "${modelKey}" cap.default must be a number`);
    if ((cap as Record<string, unknown>).hard !== undefined) {
      assertNumber((cap as Record<string, unknown>).hard, `models.json: model "${modelKey}" cap.hard must be a number`);
    }

    assertObject(pricing, `models.json: model "${modelKey}" pricing must be an object`);
    assertNumber((pricing as Record<string, unknown>).input, `models.json: model "${modelKey}" pricing.input must be a number`);
    assertNumber((pricing as Record<string, unknown>).output, `models.json: model "${modelKey}" pricing.output must be a number`);

    const pricingCurrency = (pricing as Record<string, unknown>).currency;
    if (pricingCurrency !== undefined && (typeof pricingCurrency !== 'string' || pricingCurrency.trim() === '')) {
      throw new Error(`models.json: model "${modelKey}" pricing.currency must be a string`);
    }

    models[modelKey] = {
      provider,
      model,
      max_output_tokens: maxOutputTokens,
      temperature: temperature as number | undefined,
      cap: {
        default: (cap as Record<string, number>).default,
        hard: (cap as Record<string, number>).hard,
      },
      pricing: {
        currency: pricingCurrency as string | undefined,
        input: (pricing as Record<string, number>).input,
        output: (pricing as Record<string, number>).output,
      },
    };
  }

  for (const [alias, modelKey] of Object.entries(aliases)) {
    if (!models[modelKey]) {
      throw new Error(`models.json: alias "${alias}" aponta para modelo desconhecido "${modelKey}"`);
    }
  }

  modelsCache = { aliases, models };
  return modelsCache;
}

export function loadPoliciesConfig(): PoliciesConfig {
  if (policiesCache) {
    return policiesCache;
  }

  const raw = readFileSync(getConfPath('policies.json'), 'utf-8');
  const parsed = JSON.parse(raw) as Partial<PoliciesConfig>;

  if (!parsed.routing) {
    throw new Error('policies.json: missing routing block');
  }

  if (!parsed.caps) {
    throw new Error('policies.json: missing caps block');
  }

  if (!parsed.temperatures) {
    throw new Error('policies.json: missing temperatures block');
  }

  const routing = parsed.routing as RoutingPolicy;
  if (typeof routing.defaultAlias !== 'string' || routing.defaultAlias.trim() === '') {
    throw new Error('policies.json: routing.defaultAlias must be a string');
  }

  if (!routing.languageHeuristics || typeof routing.languageHeuristics !== 'object') {
    throw new Error('policies.json: routing.languageHeuristics must be an object');
  }

  if (!Array.isArray(routing.tokenBuckets)) {
    throw new Error('policies.json: routing.tokenBuckets must be an array');
  }

  if (!routing.fallbacks || typeof routing.fallbacks !== 'object') {
    throw new Error('policies.json: routing.fallbacks must be an object');
  }

  const languageHeuristics: Record<string, LanguageHeuristic> = {};
  for (const [key, value] of Object.entries(routing.languageHeuristics)) {
    if (!value || typeof value !== 'object') {
      throw new Error(`policies.json: routing.languageHeuristics[${key}] must be an object`);
    }
    const heuristic: LanguageHeuristic = {};
    if ((value as Record<string, unknown>).alias !== undefined) {
      const alias = (value as Record<string, unknown>).alias;
      if (typeof alias !== 'string' || alias.trim() === '') {
        throw new Error(`policies.json: routing.languageHeuristics[${key}].alias must be a string`);
      }
      heuristic.alias = alias;
    }
    if ((value as Record<string, unknown>).temperature !== undefined) {
      assertNumber((value as Record<string, unknown>).temperature, `policies.json: routing.languageHeuristics[${key}].temperature must be a number`);
      heuristic.temperature = (value as Record<string, number>).temperature;
    }
    languageHeuristics[key] = heuristic;
  }

  const tokenBuckets: TokenBucketRule[] = routing.tokenBuckets.map((bucket, idx) => {
    if (!bucket || typeof bucket !== 'object') {
      throw new Error(`policies.json: routing.tokenBuckets[${idx}] must be an object`);
    }
    if (typeof bucket.alias !== 'string' || bucket.alias.trim() === '') {
      throw new Error(`policies.json: routing.tokenBuckets[${idx}].alias must be a string`);
    }
    const rule: TokenBucketRule = { alias: bucket.alias };
    if (bucket.minPromptTokens !== undefined) {
      assertNumber(bucket.minPromptTokens, `policies.json: routing.tokenBuckets[${idx}].minPromptTokens must be a number`);
      rule.minPromptTokens = bucket.minPromptTokens;
    }
    if (bucket.maxPromptTokens !== undefined) {
      assertNumber(bucket.maxPromptTokens, `policies.json: routing.tokenBuckets[${idx}].maxPromptTokens must be a number`);
      rule.maxPromptTokens = bucket.maxPromptTokens;
    }
    return rule;
  });

  const fallbacks: Record<string, string[]> = {};
  for (const [alias, list] of Object.entries(routing.fallbacks)) {
    if (!Array.isArray(list)) {
      throw new Error(`policies.json: routing.fallbacks[${alias}] must be an array`);
    }
    fallbacks[alias] = list.filter((value) => typeof value === 'string' && value.trim() !== '');
  }

  const caps = parsed.caps as CapsPolicy;
  assertNumber(caps.default, 'policies.json: caps.default must be a number');
  if (caps.tiers) {
    for (const [tier, limit] of Object.entries(caps.tiers)) {
      assertNumber(limit, `policies.json: caps.tiers.${tier} must be a number`);
    }
  }

  const temperatures = parsed.temperatures as TemperaturesPolicy;
  assertNumber(temperatures.default, 'policies.json: temperatures.default must be a number');
  if (temperatures.code !== undefined) {
    assertNumber(temperatures.code, 'policies.json: temperatures.code must be a number');
  }
  if (temperatures.creative !== undefined) {
    assertNumber(temperatures.creative, 'policies.json: temperatures.creative must be a number');
  }

  policiesCache = {
    routing: {
      defaultAlias: routing.defaultAlias,
      languageHeuristics,
      tokenBuckets,
      fallbacks,
    },
    caps,
    temperatures,
  };

  return policiesCache;
}
