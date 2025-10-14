// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/stdio.js";

// src/config.ts
import { readFileSync } from "fs";
import path from "path";
var modelsCache = null;
var policiesCache = null;
function getConfPath(filename) {
  return path.resolve(__dirname, "..", "conf", filename);
}
function assertNumber(value, message) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(message);
  }
}
function assertObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
}
function loadModelsConfig() {
  if (modelsCache) {
    return modelsCache;
  }
  const raw = readFileSync(getConfPath("models.json"), "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed.aliases || typeof parsed.aliases !== "object") {
    throw new Error("models.json: missing aliases map");
  }
  if (!parsed.models || typeof parsed.models !== "object") {
    throw new Error("models.json: missing models map");
  }
  const aliases = {};
  for (const [alias, modelKey] of Object.entries(parsed.aliases)) {
    if (typeof alias !== "string" || alias.trim() === "") {
      throw new Error(`models.json: invalid alias name "${alias}"`);
    }
    if (typeof modelKey !== "string" || modelKey.trim() === "") {
      throw new Error(`models.json: alias "${alias}" has invalid target`);
    }
    aliases[alias] = modelKey;
  }
  const models = {};
  for (const [modelKey, value] of Object.entries(parsed.models)) {
    assertObject(value, `models.json: model "${modelKey}" must be an object`);
    const provider = value.provider;
    const model = value.model;
    const maxOutputTokens = value.max_output_tokens;
    const temperature = value.temperature;
    const cap = value.cap;
    const pricing = value.pricing;
    if (typeof provider !== "string" || provider.trim() === "") {
      throw new Error(`models.json: model "${modelKey}" missing provider`);
    }
    if (typeof model !== "string" || model.trim() === "") {
      throw new Error(`models.json: model "${modelKey}" missing model identifier`);
    }
    assertNumber(maxOutputTokens, `models.json: model "${modelKey}" max_output_tokens must be a number`);
    if (temperature !== void 0) {
      assertNumber(temperature, `models.json: model "${modelKey}" temperature must be a number`);
    }
    assertObject(cap, `models.json: model "${modelKey}" cap must be an object`);
    assertNumber(cap.default, `models.json: model "${modelKey}" cap.default must be a number`);
    if (cap.hard !== void 0) {
      assertNumber(cap.hard, `models.json: model "${modelKey}" cap.hard must be a number`);
    }
    assertObject(pricing, `models.json: model "${modelKey}" pricing must be an object`);
    assertNumber(pricing.input, `models.json: model "${modelKey}" pricing.input must be a number`);
    assertNumber(pricing.output, `models.json: model "${modelKey}" pricing.output must be a number`);
    const pricingCurrency = pricing.currency;
    if (pricingCurrency !== void 0 && (typeof pricingCurrency !== "string" || pricingCurrency.trim() === "")) {
      throw new Error(`models.json: model "${modelKey}" pricing.currency must be a string`);
    }
    models[modelKey] = {
      provider,
      model,
      max_output_tokens: maxOutputTokens,
      temperature,
      cap: {
        default: cap.default,
        hard: cap.hard
      },
      pricing: {
        currency: pricingCurrency,
        input: pricing.input,
        output: pricing.output
      }
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
function loadPoliciesConfig() {
  if (policiesCache) {
    return policiesCache;
  }
  const raw = readFileSync(getConfPath("policies.json"), "utf-8");
  const parsed = JSON.parse(raw);
  if (!parsed.routing) {
    throw new Error("policies.json: missing routing block");
  }
  if (!parsed.caps) {
    throw new Error("policies.json: missing caps block");
  }
  if (!parsed.temperatures) {
    throw new Error("policies.json: missing temperatures block");
  }
  const routing = parsed.routing;
  if (typeof routing.defaultAlias !== "string" || routing.defaultAlias.trim() === "") {
    throw new Error("policies.json: routing.defaultAlias must be a string");
  }
  if (!routing.languageHeuristics || typeof routing.languageHeuristics !== "object") {
    throw new Error("policies.json: routing.languageHeuristics must be an object");
  }
  if (!Array.isArray(routing.tokenBuckets)) {
    throw new Error("policies.json: routing.tokenBuckets must be an array");
  }
  if (!routing.fallbacks || typeof routing.fallbacks !== "object") {
    throw new Error("policies.json: routing.fallbacks must be an object");
  }
  const languageHeuristics = {};
  for (const [key, value] of Object.entries(routing.languageHeuristics)) {
    if (!value || typeof value !== "object") {
      throw new Error(`policies.json: routing.languageHeuristics[${key}] must be an object`);
    }
    const heuristic = {};
    if (value.alias !== void 0) {
      const alias = value.alias;
      if (typeof alias !== "string" || alias.trim() === "") {
        throw new Error(`policies.json: routing.languageHeuristics[${key}].alias must be a string`);
      }
      heuristic.alias = alias;
    }
    if (value.temperature !== void 0) {
      assertNumber(value.temperature, `policies.json: routing.languageHeuristics[${key}].temperature must be a number`);
      heuristic.temperature = value.temperature;
    }
    languageHeuristics[key] = heuristic;
  }
  const tokenBuckets = routing.tokenBuckets.map((bucket, idx) => {
    if (!bucket || typeof bucket !== "object") {
      throw new Error(`policies.json: routing.tokenBuckets[${idx}] must be an object`);
    }
    if (typeof bucket.alias !== "string" || bucket.alias.trim() === "") {
      throw new Error(`policies.json: routing.tokenBuckets[${idx}].alias must be a string`);
    }
    const rule = { alias: bucket.alias };
    if (bucket.minPromptTokens !== void 0) {
      assertNumber(bucket.minPromptTokens, `policies.json: routing.tokenBuckets[${idx}].minPromptTokens must be a number`);
      rule.minPromptTokens = bucket.minPromptTokens;
    }
    if (bucket.maxPromptTokens !== void 0) {
      assertNumber(bucket.maxPromptTokens, `policies.json: routing.tokenBuckets[${idx}].maxPromptTokens must be a number`);
      rule.maxPromptTokens = bucket.maxPromptTokens;
    }
    return rule;
  });
  const fallbacks = {};
  for (const [alias, list] of Object.entries(routing.fallbacks)) {
    if (!Array.isArray(list)) {
      throw new Error(`policies.json: routing.fallbacks[${alias}] must be an array`);
    }
    fallbacks[alias] = list.filter((value) => typeof value === "string" && value.trim() !== "");
  }
  const caps = parsed.caps;
  assertNumber(caps.default, "policies.json: caps.default must be a number");
  if (caps.tiers) {
    for (const [tier, limit] of Object.entries(caps.tiers)) {
      assertNumber(limit, `policies.json: caps.tiers.${tier} must be a number`);
    }
  }
  const temperatures = parsed.temperatures;
  assertNumber(temperatures.default, "policies.json: temperatures.default must be a number");
  if (temperatures.code !== void 0) {
    assertNumber(temperatures.code, "policies.json: temperatures.code must be a number");
  }
  if (temperatures.creative !== void 0) {
    assertNumber(temperatures.creative, "policies.json: temperatures.creative must be a number");
  }
  policiesCache = {
    routing: {
      defaultAlias: routing.defaultAlias,
      languageHeuristics,
      tokenBuckets,
      fallbacks
    },
    caps,
    temperatures
  };
  return policiesCache;
}

// src/router.ts
var MIN_TEMPERATURE = 0;
var MAX_TEMPERATURE = 2;
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
function normalizeLanguageCode(language) {
  if (!language) {
    return void 0;
  }
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return void 0;
  }
  if (normalized.startsWith("pt")) {
    return "pt";
  }
  if (normalized.startsWith("en")) {
    return "en";
  }
  if (normalized.startsWith("es")) {
    return "es";
  }
  return normalized;
}
function detectLanguage(text) {
  const sample = text.slice(0, 512).toLowerCase();
  if (!sample) {
    return void 0;
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
  const scores = [
    { code: "pt", score: scorePt },
    { code: "es", score: scoreEs },
    { code: "en", score: scoreEn }
  ];
  scores.sort((a, b) => b.score - a.score);
  if (scores[0].score === 0 || scores[0].score === scores[1].score) {
    return void 0;
  }
  return scores[0].code;
}
function estimateTokens(text) {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil(text.length / 3));
}
function resolveModel(target, rationale) {
  const modelsConfig = loadModelsConfig();
  const modelKeyFromAlias = modelsConfig.aliases[target];
  if (modelKeyFromAlias) {
    const modelInfo2 = modelsConfig.models[modelKeyFromAlias];
    if (!modelInfo2) {
      throw new Error(`Alias "${target}" aponta para modelo inexistente "${modelKeyFromAlias}"`);
    }
    rationale.push(`Alias "${target}" resolve para ${modelInfo2.provider}/${modelInfo2.model}.`);
    return {
      decision: {
        alias: target,
        modelId: modelKeyFromAlias,
        provider: modelInfo2.provider,
        model: modelInfo2.model
      },
      modelInfo: modelInfo2
    };
  }
  const modelInfo = modelsConfig.models[target];
  if (modelInfo) {
    const aliasEntry = Object.entries(modelsConfig.aliases).find(([, modelId]) => modelId === target);
    const alias = aliasEntry ? aliasEntry[0] : target;
    rationale.push(`Modelo "${target}" ser\xE1 usado diretamente (${modelInfo.provider}/${modelInfo.model}).`);
    return {
      decision: {
        alias,
        modelId: target,
        provider: modelInfo.provider,
        model: modelInfo.model
      },
      modelInfo
    };
  }
  throw new Error(`Modelo ou alias desconhecido: ${target}`);
}
function selectAliasByBucket(estimatedTokens) {
  const { tokenBuckets } = loadPoliciesConfig().routing;
  for (const bucket of tokenBuckets) {
    const min = bucket.minPromptTokens ?? 0;
    const max = bucket.maxPromptTokens ?? Number.POSITIVE_INFINITY;
    if (estimatedTokens >= min && estimatedTokens < max) {
      return bucket.alias;
    }
  }
  return void 0;
}
function applyCapLimits(target, modelInfo) {
  const values = [target, modelInfo.cap.default, modelInfo.max_output_tokens];
  if (typeof modelInfo.cap.hard === "number") {
    values.push(modelInfo.cap.hard);
  }
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0);
  const candidate = Math.min(...filtered);
  return Math.max(1, Math.floor(candidate));
}
function routeRequest(request) {
  if (!request || typeof request.prompt !== "string") {
    throw new Error("routeRequest: prompt ausente");
  }
  const modelsConfig = loadModelsConfig();
  const policies = loadPoliciesConfig();
  const rationale = [];
  const estimatedTokens = estimateTokens(request.prompt);
  rationale.push(`Estimativa de tokens de entrada: ~${estimatedTokens}.`);
  const metadata = request.metadata ?? {};
  const normalizedLanguage = normalizeLanguageCode(metadata.language) ?? detectLanguage(request.prompt);
  if (normalizedLanguage) {
    rationale.push(`Idioma considerado: ${normalizedLanguage}.`);
  }
  let selectedAlias = policies.routing.defaultAlias;
  rationale.push(`Alias padr\xE3o da pol\xEDtica: ${selectedAlias}.`);
  if (request.forceModel) {
    rationale.push(`forceModel recebido: ${request.forceModel}.`);
    const resolved2 = resolveModel(request.forceModel, rationale);
    const policyCap2 = resolvePolicyCap(metadata.tier, rationale);
    const targetCap2 = applyRequestCaps(policyCap2, request.caps, rationale);
    const maxOutputTokens2 = applyCapLimits(targetCap2, resolved2.modelInfo);
    const temperature2 = resolveTemperature(metadata, resolved2.modelInfo, rationale);
    const fallbackDecisions = resolveFallbacks(resolved2.decision.alias, rationale);
    return {
      decision: resolved2.decision,
      parameters: {
        max_output_tokens: maxOutputTokens2,
        temperature: temperature2
      },
      rationale,
      fallbacks: fallbackDecisions,
      usage: {
        estimated_input_tokens: estimatedTokens
      },
      meta: {
        target_max_output_tokens: targetCap2
      }
    };
  }
  const bucketAlias = selectAliasByBucket(estimatedTokens);
  if (bucketAlias) {
    selectedAlias = bucketAlias;
    rationale.push(`Bucket de tokens selecionou alias ${bucketAlias}.`);
  }
  let temperatureOverride;
  if (normalizedLanguage) {
    const languagePolicy = policies.routing.languageHeuristics[normalizedLanguage];
    if (languagePolicy) {
      if (languagePolicy.alias && languagePolicy.alias !== selectedAlias) {
        selectedAlias = languagePolicy.alias;
        rationale.push(`Heur\xEDstica de idioma ajustou alias para ${selectedAlias}.`);
      }
      if (typeof languagePolicy.temperature === "number") {
        temperatureOverride = languagePolicy.temperature;
        rationale.push(`Heur\xEDstica de idioma sugeriu temperatura ${languagePolicy.temperature}.`);
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
      temperature
    },
    rationale,
    fallbacks,
    usage: {
      estimated_input_tokens: estimatedTokens
    },
    meta: {
      target_max_output_tokens: targetCap
    }
  };
}
function resolvePolicyCap(tier, rationale) {
  const policies = loadPoliciesConfig();
  let limit = policies.caps.default;
  if (tier) {
    const normalizedTier = tier.trim().toLowerCase();
    const tierCap = policies.caps.tiers?.[normalizedTier];
    if (tierCap) {
      rationale.push(`Cap de tier "${normalizedTier}": ${tierCap}.`);
      limit = tierCap;
    } else {
      rationale.push(`Tier "${normalizedTier}" sem cap espec\xEDfico, usando padr\xE3o ${limit}.`);
    }
  } else {
    rationale.push(`Cap padr\xE3o aplicado: ${limit}.`);
  }
  return limit;
}
function applyRequestCaps(policyCap, caps, rationale) {
  let target = policyCap;
  if (caps?.maxOutputTokens && caps.maxOutputTokens > 0) {
    target = Math.min(target, caps.maxOutputTokens);
    rationale.push(`Cap solicitado na requisi\xE7\xE3o: ${caps.maxOutputTokens}.`);
  }
  return target;
}
function resolveTemperature(metadata, modelInfo, rationale, languageOverride) {
  const policies = loadPoliciesConfig();
  let temperature = typeof modelInfo.temperature === "number" ? modelInfo.temperature : policies.temperatures.default;
  rationale.push(`Temperatura base do modelo/pol\xEDtica: ${temperature}.`);
  if (typeof languageOverride === "number") {
    temperature = languageOverride;
    rationale.push(`Temperatura ajustada pela heur\xEDstica de idioma: ${temperature}.`);
  }
  if (metadata.domain) {
    const domainTemp = policies.temperatures[metadata.domain];
    if (typeof domainTemp === "number") {
      temperature = domainTemp;
      rationale.push(`Temperatura ajustada pelo dom\xEDnio "${metadata.domain}": ${temperature}.`);
    }
  }
  if (typeof metadata.temperature === "number") {
    temperature = metadata.temperature;
    rationale.push(`Temperatura explicitamente definida na requisi\xE7\xE3o: ${temperature}.`);
  }
  temperature = clamp(temperature, MIN_TEMPERATURE, MAX_TEMPERATURE);
  rationale.push(`Temperatura final ap\xF3s clamp: ${temperature}.`);
  return temperature;
}
function resolveFallbacks(primaryAlias, rationale) {
  const policies = loadPoliciesConfig();
  const fallbacks = policies.routing.fallbacks[primaryAlias] ?? [];
  const decisions = [];
  const seen = /* @__PURE__ */ new Set([primaryAlias]);
  for (const alias of fallbacks) {
    if (seen.has(alias)) {
      continue;
    }
    try {
      const resolved = resolveModel(alias, rationale);
      decisions.push(resolved.decision);
      seen.add(alias);
    } catch (error) {
      rationale.push(`Fallback ignorado "${alias}": ${error.message}.`);
    }
  }
  if (decisions.length) {
    rationale.push(`Fallbacks dispon\xEDveis: ${decisions.map((item) => item.alias).join(", ")}.`);
  } else {
    rationale.push("Nenhum fallback configurado para o alias selecionado.");
  }
  return decisions;
}
function computeMaxTokensForModel(targetCap, modelId) {
  const modelsConfig = loadModelsConfig();
  const modelInfo = modelsConfig.models[modelId];
  if (!modelInfo) {
    throw new Error(`Modelo desconhecido: ${modelId}`);
  }
  return applyCapLimits(targetCap, modelInfo);
}

// src/delegate.ts
function sanitizeTokens(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return void 0;
  }
  return Math.max(0, Math.round(value));
}
async function run(request, context) {
  if (!context?.providers) {
    throw new Error("delegate.run: nenhum provider registrado");
  }
  const routing = routeRequest(request);
  const modelsConfig = loadModelsConfig();
  const attempts = [];
  const candidates = [routing.decision, ...routing.fallbacks];
  const errors = [];
  const logger2 = context.logger;
  for (let index = 0; index < candidates.length; index += 1) {
    const decision = candidates[index];
    const providerHandler = context.providers[decision.provider];
    const attemptEntry = {
      alias: decision.alias,
      provider: decision.provider,
      model: decision.model,
      success: false
    };
    if (!providerHandler) {
      const message = `Provider "${decision.provider}" n\xE3o registrado.`;
      attemptEntry.error = message;
      attempts.push(attemptEntry);
      errors.push(message);
      logger2?.warn?.(message);
      continue;
    }
    const cappedMaxTokens = computeMaxTokensForModel(routing.meta.target_max_output_tokens, decision.modelId);
    const parameters = {
      max_output_tokens: cappedMaxTokens,
      temperature: routing.parameters.temperature
    };
    try {
      const response = await providerHandler({
        prompt: request.prompt,
        decision,
        parameters,
        request
      });
      const providerUsage = response.usage ?? {};
      const estimatedInputTokens = routing.usage.estimated_input_tokens;
      const sanitizedInput = sanitizeTokens(providerUsage.inputTokens);
      const sanitizedOutput = sanitizeTokens(providerUsage.outputTokens);
      const sanitizedTotal = sanitizeTokens(providerUsage.totalTokens);
      const onlyTotalProvided = sanitizedTotal !== void 0 && sanitizedInput === void 0 && sanitizedOutput === void 0;
      const tokenFallbackNotes = [];
      let inputTokens = sanitizedInput ?? estimatedInputTokens;
      let outputTokens = sanitizedOutput ?? 0;
      if (onlyTotalProvided) {
        inputTokens = sanitizedTotal;
        outputTokens = 0;
        const message = "Provider informou apenas totalTokens; assumindo total como input_tokens e output_tokens=0.";
        tokenFallbackNotes.push(message);
        logger2?.debug?.(
          "delegate.run: somente totalTokens fornecido; adotando input=%d e output=%d para c\xE1lculo de custos.",
          inputTokens,
          outputTokens
        );
      } else {
        if (sanitizedInput === void 0 && sanitizedTotal !== void 0) {
          inputTokens = Math.max(sanitizedTotal - outputTokens, 0);
        }
        if (sanitizedOutput === void 0 && sanitizedTotal !== void 0) {
          outputTokens = Math.max(sanitizedTotal - inputTokens, 0);
        }
      }
      const totalTokens = sanitizedTotal ?? inputTokens + outputTokens;
      const modelInfo = modelsConfig.models[decision.modelId];
      if (!modelInfo) {
        throw new Error(`Modelo ${decision.modelId} n\xE3o encontrado na configura\xE7\xE3o.`);
      }
      const currency = modelInfo.pricing.currency ?? "USD";
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
      logger2?.info?.(`delegate.run: chamada bem sucedida com ${decision.provider}/${decision.model}.`);
      return {
        text: response.outputText,
        decision,
        parameters,
        rationale,
        usage: {
          estimated_input_tokens: estimatedInputTokens,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          total_tokens: totalTokens
        },
        cost: {
          currency,
          input: inputCost,
          output: outputCost,
          total: totalCost
        },
        meta: {
          rawResponse: response.raw,
          fallback_used: fallbackUsed,
          attempts
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptEntry.error = message;
      attempts.push(attemptEntry);
      errors.push(message);
      logger2?.error?.(`delegate.run: erro ao chamar ${decision.provider}/${decision.model}: ${message}`);
    }
  }
  const errorMessage = `delegate.run: todas as tentativas falharam (${errors.join("; ")}).`;
  throw new Error(errorMessage);
}

// src/tools/diff.ts
function buildFileContext(files) {
  if (!files?.length) {
    return "";
  }
  const rendered = files.map((file) => {
    const header = `File: ${file.path}`;
    const separator = "-".repeat(header.length);
    const body = file.contents.trimEnd();
    return `${header}
${separator}
${body}`;
  }).join("\n\n");
  return `
Provided files:
${rendered}`;
}
function stripCodeFences(text) {
  const trimmed = text.trim();
  const fencePattern = /^```[a-zA-Z0-9:-]*\n([\s\S]*?)\n```$/;
  const match = trimmed.match(fencePattern);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}
function validateDiffOutput(diffText) {
  if (!diffText.startsWith("diff --git ")) {
    throw new Error('delegate.diff: resposta n\xE3o cont\xE9m patch unificado iniciando com "diff --git".');
  }
  if (!diffText.includes("\n@@")) {
    throw new Error("delegate.diff: patch sem hunks @@ inv\xE1lido.");
  }
}
function buildPrompt(input) {
  const baseInstructions = [
    "You are delegate.diff, an assistant that returns Git patches.",
    'Respond with a unified diff using "diff --git" headers and @@ hunks.',
    "Do not include explanations, commentary, or code fences.",
    "Only include files that actually change.",
    "Use LF line endings and preserve existing indentation.",
    "If no change is required, return an empty diff that only contains diff --git headers with no modifications."
  ].join("\n");
  const supplementalContext = input.context ? `
Additional context:
${input.context.trim()}` : "";
  const fileContext = buildFileContext(input.files);
  return `${baseInstructions}${supplementalContext}${fileContext}

User instructions:
${input.instructions.trim()}
`;
}
function buildRouteRequest(input, prompt) {
  const metadata = {
    language: input.language,
    domain: "code",
    tier: input.tier,
    temperature: input.temperature
  };
  const caps = typeof input.maxOutputTokens === "number" && input.maxOutputTokens > 0 ? { maxOutputTokens: input.maxOutputTokens } : void 0;
  return {
    prompt,
    forceModel: input.forceModel,
    metadata,
    caps
  };
}
async function executeDelegateDiff(input, context) {
  if (!input?.instructions?.trim()) {
    throw new Error('delegate.diff: campo "instructions" \xE9 obrigat\xF3rio.');
  }
  const prompt = buildPrompt(input);
  const request = buildRouteRequest(input, prompt);
  const runResult = await run(request, context);
  const sanitized = stripCodeFences(runResult.text);
  validateDiffOutput(sanitized);
  const result = {
    ...runResult,
    text: sanitized
  };
  return {
    text: sanitized,
    result
  };
}

// src/tools/tests.ts
function buildPrompt2(input) {
  const rules = [
    "You are delegate.tests, an assistant that designs deterministic testing plans.",
    'Return Markdown with exactly two sections: "## Commands" and "## Files" in this order.',
    'In "## Commands" list shell commands using bullet points with inline code.',
    'In "## Files" provide one or more fenced code blocks labelled with the file path, like ```path/to/file.ext`.',
    "Use deterministic seeds and avoid external services.",
    "Do not add commentary outside of these sections."
  ].join("\n");
  const frameworkNote = input.framework ? `
Preferred framework: ${input.framework.trim()}.` : "";
  const extraContext = input.context ? `
Context:
${input.context.trim()}` : "";
  return `${rules}${frameworkNote}${extraContext}

User instructions:
${input.instructions.trim()}
`;
}
function buildRouteRequest2(input, prompt) {
  const metadata = {
    language: input.language,
    domain: "code",
    tier: input.tier,
    temperature: input.temperature
  };
  const caps = typeof input.maxOutputTokens === "number" && input.maxOutputTokens > 0 ? { maxOutputTokens: input.maxOutputTokens } : void 0;
  return {
    prompt,
    forceModel: input.forceModel,
    metadata,
    caps
  };
}
function sanitizeOutput(text) {
  return text.trim();
}
function validateTestsOutput(text) {
  if (!/^## Commands/m.test(text)) {
    throw new Error('delegate.tests: se\xE7\xE3o "## Commands" ausente.');
  }
  if (!/^## Files/m.test(text)) {
    throw new Error('delegate.tests: se\xE7\xE3o "## Files" ausente.');
  }
  const filesIndex = text.indexOf("## Files");
  const commandsSegment = filesIndex >= 0 ? text.slice(0, filesIndex) : text;
  if (!/`[^`\n]+`/.test(commandsSegment)) {
    throw new Error("delegate.tests: nenhuma linha de comando detectada na se\xE7\xE3o Commands.");
  }
  const filesSection = filesIndex >= 0 ? text.slice(filesIndex) : "";
  if (!/```[^\n]*\n[\s\S]+?```/m.test(filesSection)) {
    throw new Error("delegate.tests: nenhuma code block de arquivo detectada.");
  }
}
async function executeDelegateTests(input, context) {
  if (!input?.instructions?.trim()) {
    throw new Error('delegate.tests: campo "instructions" \xE9 obrigat\xF3rio.');
  }
  const prompt = buildPrompt2(input);
  const request = buildRouteRequest2(input, prompt);
  const runResult = await run(request, context);
  const sanitized = sanitizeOutput(runResult.text);
  validateTestsOutput(sanitized);
  const result = {
    ...runResult,
    text: sanitized
  };
  return {
    text: sanitized,
    result
  };
}

// src/tools/docs.ts
function buildPrompt3(input) {
  const rules = [
    "You are delegate.docs, a technical writer producing concise Markdown.",
    "Return a short document under 200 lines.",
    "Begin with a single H1 heading summarizing the document.",
    "Organize content into focused sections using H2 or H3 headings.",
    "Avoid introductions, apologies, or filler text.",
    "Use bullet lists only when conveying steps or key points.",
    "Do not include code fences unless strictly necessary for snippets."
  ].join("\n");
  const audienceLine = input.audience ? `
Target audience: ${input.audience.trim()}.` : "";
  const toneLine = input.tone ? `
Tone: ${input.tone.trim()}.` : "";
  const extraContext = input.context ? `
Context:
${input.context.trim()}` : "";
  return `${rules}${audienceLine}${toneLine}${extraContext}

User instructions:
${input.instructions.trim()}
`;
}
function buildRouteRequest3(input, prompt) {
  const metadata = {
    language: input.language,
    domain: "default",
    tier: input.tier,
    temperature: input.temperature
  };
  const caps = typeof input.maxOutputTokens === "number" && input.maxOutputTokens > 0 ? { maxOutputTokens: input.maxOutputTokens } : void 0;
  return {
    prompt,
    forceModel: input.forceModel,
    metadata,
    caps
  };
}
function sanitizeDocsOutput(text) {
  return text.trim();
}
function validateDocsOutput(text) {
  if (!text.startsWith("# ")) {
    throw new Error("delegate.docs: documento deve iniciar com heading H1.");
  }
  const lineCount = text.split(/\r?\n/).length;
  if (lineCount > 200) {
    throw new Error("delegate.docs: documento excedeu o limite de 200 linhas.");
  }
}
async function executeDelegateDocs(input, context) {
  if (!input?.instructions?.trim()) {
    throw new Error('delegate.docs: campo "instructions" \xE9 obrigat\xF3rio.');
  }
  const prompt = buildPrompt3(input);
  const request = buildRouteRequest3(input, prompt);
  const runResult = await run(request, context);
  const sanitized = sanitizeDocsOutput(runResult.text);
  validateDocsOutput(sanitized);
  const result = {
    ...runResult,
    text: sanitized
  };
  return {
    text: sanitized,
    result
  };
}

// src/providers/anthropic.ts
import Anthropic, { APIError as AnthropicAPIError } from "@anthropic-ai/sdk";
function buildAnthropicClient(apiKey) {
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return new Anthropic({ apiKey });
}
function normalizeAnthropicError(error) {
  if (error instanceof AnthropicAPIError) {
    if (error.status === 401 || error.status === 403) {
      return new Error("anthropic: falha de autentica\xE7\xE3o. Confere ANTHROPIC_API_KEY e escopos.");
    }
    if (error.status === 408) {
      return new Error("anthropic: tempo limite excedido. Bora tentar o fallback.");
    }
    if (error.status === 429) {
      return new Error("anthropic: limite de requisi\xE7\xF5es atingido. Segura um pouco e tenta de novo.");
    }
    return new Error(`anthropic: ${error.message}`);
  }
  if (error instanceof Error) {
    const code = error.code;
    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") {
      return new Error("anthropic: conex\xE3o expirou. Vamos chamar o pr\xF3ximo da fila.");
    }
    return new Error(`anthropic: ${error.message}`);
  }
  return new Error(`anthropic: falha inesperada (${String(error)})`);
}
function createAnthropicProvider(options) {
  const client = buildAnthropicClient(options?.apiKey);
  return async ({ prompt, decision, parameters }) => {
    if (!client) {
      throw new Error("anthropic: chave de API n\xE3o configurada. Define ANTHROPIC_API_KEY.");
    }
    try {
      const response = await client.responses.create({
        model: decision.model,
        max_output_tokens: parameters.max_output_tokens,
        temperature: parameters.temperature,
        input: prompt
      });
      const outputText = typeof response.output_text === "string" ? response.output_text : Array.isArray(response.output) ? response.output.map((item) => {
        if (item.type === "output_text" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      }).join("") : "";
      return {
        outputText,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          totalTokens: response.usage?.total_tokens
        },
        raw: response
      };
    } catch (error) {
      throw normalizeAnthropicError(error);
    }
  };
}

// src/providers/google.ts
import { GenerativeServiceClient } from "@google-ai/generativelanguage";
import { GoogleAuth } from "google-auth-library";
function ensureModelName(model) {
  return model.startsWith("models/") ? model : `models/${model}`;
}
function extractGoogleText(response) {
  const parts = [];
  for (const candidate of response.candidates ?? []) {
    const candidateParts = candidate.content?.parts ?? [];
    for (const part of candidateParts) {
      if ("text" in part && typeof part.text === "string") {
        parts.push(part.text);
      }
    }
  }
  return parts.join("");
}
function normalizeGoogleError(error) {
  const numericCode = typeof error.code === "number" ? error.code : void 0;
  const httpStatus = typeof error.status === "number" ? error.status : void 0;
  const grpcStatus = typeof error.status === "string" ? error.status : void 0;
  const statusMessage = typeof error.statusMessage === "string" ? error.statusMessage : void 0;
  const baseMessage = error instanceof Error ? error.message : String(error);
  if (baseMessage.trim().toLowerCase().startsWith("google:")) {
    return new Error(baseMessage);
  }
  if (httpStatus === 401 || httpStatus === 403 || grpcStatus === "UNAUTHENTICATED" || grpcStatus === "PERMISSION_DENIED" || numericCode === 7 || numericCode === 16) {
    return new Error("google: falha de autentica\xE7\xE3o. Confere GOOGLE_API_KEY e habilita o Gemini.");
  }
  if (httpStatus === 408 || httpStatus === 504 || grpcStatus === "DEADLINE_EXCEEDED" || grpcStatus === "UNAVAILABLE" || numericCode === 4 || numericCode === 14) {
    return new Error("google: tempo limite ou indisponibilidade. Chamando fallback.");
  }
  if (httpStatus === 429 || grpcStatus === "RESOURCE_EXHAUSTED" || numericCode === 8) {
    return new Error("google: cota ou rate limit batendo forte. Espera um pouco ou troca de provedor.");
  }
  if (error instanceof Error) {
    const errno = error.code;
    if (errno === "ETIMEDOUT" || errno === "ESOCKETTIMEDOUT") {
      return new Error("google: conex\xE3o expirou. Partiu fallback.");
    }
    if (errno === "ECONNREFUSED" || errno === "ECONNRESET") {
      return new Error("google: conex\xE3o com a API falhou. Tenta outro provider rapidinho.");
    }
  }
  if (statusMessage && statusMessage.trim() !== "") {
    return new Error(`google: ${statusMessage}`);
  }
  return new Error(`google: ${baseMessage}`);
}
async function createGoogleClient(apiKey) {
  const trimmed = apiKey?.trim();
  if (!trimmed) {
    throw new Error("google: chave de API n\xE3o configurada. Define GOOGLE_API_KEY.");
  }
  const authClient = await new GoogleAuth().fromAPIKey(trimmed);
  return new GenerativeServiceClient({ authClient });
}
function createGoogleProvider(options) {
  const apiKey = options?.apiKey ?? process.env.GOOGLE_AI_API_KEY;
  const clientPromise = apiKey && apiKey.trim() !== "" ? createGoogleClient(apiKey).catch((error) => {
    throw normalizeGoogleError(error);
  }) : null;
  return async ({ prompt, decision, parameters }) => {
    if (!clientPromise) {
      throw new Error("google: chave de API n\xE3o configurada. Define GOOGLE_API_KEY.");
    }
    let client;
    try {
      client = await clientPromise;
    } catch (error) {
      throw normalizeGoogleError(error);
    }
    const generationConfig = {};
    if (typeof parameters.max_output_tokens === "number") {
      generationConfig.maxOutputTokens = parameters.max_output_tokens;
    }
    if (typeof parameters.temperature === "number") {
      generationConfig.temperature = parameters.temperature;
    }
    const request = {
      model: ensureModelName(decision.model),
      contents: [
        {
          role: "user",
          parts: [
            {
              text: prompt
            }
          ]
        }
      ],
      ...Object.keys(generationConfig).length > 0 ? { generationConfig } : {}
    };
    try {
      const [response] = await client.generateContent(request);
      const outputText = extractGoogleText(response) ?? "";
      const usage = response.usageMetadata;
      return {
        outputText,
        usage: usage ? {
          inputTokens: usage.promptTokenCount,
          outputTokens: usage.candidatesTokenCount,
          totalTokens: usage.totalTokenCount
        } : void 0,
        raw: response
      };
    } catch (error) {
      throw normalizeGoogleError(error);
    }
  };
}

// src/providers/openai.ts
import OpenAI, { APIError as OpenAIAPIError } from "openai";
function buildOpenAIClient(apiKey) {
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return new OpenAI({ apiKey });
}
function normalizeOpenAIError(error) {
  if (error instanceof OpenAIAPIError) {
    if (error.status === 401 || error.status === 403) {
      return new Error("openai: falha de autentica\xE7\xE3o. Confere OPENAI_API_KEY e permiss\xF5es.");
    }
    if (error.status === 408) {
      return new Error("openai: tempo limite excedido ao gerar resposta. Tenta de novo daqui a pouco.");
    }
    if (error.status === 429) {
      return new Error("openai: limite de requisi\xE7\xF5es atingido. Aguarda um pouco antes de tentar de novo.");
    }
    return new Error(`openai: ${error.message}`);
  }
  if (error instanceof Error) {
    const timeoutCodes = /* @__PURE__ */ new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT"]);
    const networkCodes = /* @__PURE__ */ new Set(["ECONNRESET", "ECONNREFUSED"]);
    const code = error.code;
    if (code && timeoutCodes.has(code)) {
      return new Error("openai: tempo limite na conex\xE3o. Tenta novamente em instantes.");
    }
    if (code && networkCodes.has(code)) {
      return new Error("openai: conex\xE3o com a API falhou. D\xE1 uma conferida e tenta outra rota.");
    }
    return new Error(`openai: ${error.message}`);
  }
  return new Error(`openai: falha inesperada (${String(error)})`);
}
function createOpenAIProvider(options) {
  const client = buildOpenAIClient(options?.apiKey);
  return async ({ prompt, decision, parameters }) => {
    if (!client) {
      throw new Error("openai: chave de API n\xE3o configurada. Define OPENAI_API_KEY.");
    }
    try {
      const response = await client.responses.create({
        model: decision.model,
        input: prompt,
        temperature: parameters.temperature,
        max_output_tokens: parameters.max_output_tokens
      });
      const outputText = typeof response.output_text === "string" ? response.output_text : Array.isArray(response.output) ? response.output.map((item) => {
        if (item.type === "output_text" && typeof item.text === "string") {
          return item.text;
        }
        return "";
      }).join("") : "";
      return {
        outputText,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
          totalTokens: response.usage?.total_tokens
        },
        raw: response
      };
    } catch (error) {
      throw normalizeOpenAIError(error);
    }
  };
}

// src/providers/index.ts
function createProvidersFromEnv(config) {
  const openaiKey = config?.openaiApiKey ?? process.env.OPENAI_API_KEY;
  const anthropicKey = config?.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
  const googleKey = config?.googleApiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
  return {
    openai: createOpenAIProvider({ apiKey: openaiKey }),
    anthropic: createAnthropicProvider({ apiKey: anthropicKey }),
    google: createGoogleProvider({ apiKey: googleKey })
  };
}
function createDelegateContext(logger2) {
  return {
    providers: createProvidersFromEnv(),
    logger: logger2
  };
}

// src/index.ts
var logger = {
  debug: (...args) => console.debug("[axcess]", ...args),
  info: (...args) => console.info("[axcess]", ...args),
  warn: (...args) => console.warn("[axcess]", ...args),
  error: (...args) => console.error("[axcess]", ...args)
};
var delegateContext = createDelegateContext(logger);
var server = new Server({
  name: "axcess-mcp",
  version: "0.1.0"
});
server.tool(
  "delegate.run",
  {
    description: "Roteia prompts para os modelos configurados e retorna a resposta.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Prompt a ser encaminhado para o roteador."
        },
        forceModel: {
          type: "string",
          description: "Modelo ou alias for\xE7ado, ignorando heur\xEDsticas."
        },
        metadata: {
          type: "object",
          description: "Metadados opcionais que ajudam no roteamento.",
          properties: {
            language: { type: "string" },
            tier: { type: "string" },
            domain: {
              type: "string",
              enum: ["code", "creative", "default"]
            },
            temperature: { type: "number" }
          },
          additionalProperties: false
        },
        caps: {
          type: "object",
          description: "Limites adicionais para a requisi\xE7\xE3o.",
          properties: {
            maxOutputTokens: { type: "number" }
          },
          additionalProperties: false
        }
      },
      required: ["prompt"],
      additionalProperties: false
    }
  },
  async ({ input }) => {
    const request = {
      prompt: input.prompt,
      forceModel: input.forceModel,
      metadata: input.metadata,
      caps: input.caps
    };
    try {
      const result = await run(request, delegateContext);
      logDelegateResult("delegate.run", result);
      return buildToolResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("delegate.run: falha ao processar request", message);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: message
          }
        ]
      };
    }
  }
);
server.tool(
  "delegate.diff",
  {
    description: "Gera um patch unificado (diff --git) a partir de instru\xE7\xF5es de refatora\xE7\xE3o.",
    inputSchema: {
      type: "object",
      properties: {
        instructions: {
          type: "string",
          description: "Instru\xE7\xF5es detalhadas para gerar o patch."
        },
        context: { type: "string" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              contents: { type: "string" }
            },
            required: ["path", "contents"],
            additionalProperties: false
          }
        },
        language: { type: "string" },
        tier: { type: "string" },
        temperature: { type: "number" },
        forceModel: { type: "string" },
        maxOutputTokens: { type: "number" }
      },
      required: ["instructions"],
      additionalProperties: false
    }
  },
  async ({ input }) => {
    try {
      const result = await executeDelegateDiff(input, delegateContext);
      logDelegateResult("delegate.diff", result.result);
      return buildToolResponse(result.result, result.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("delegate.diff: falha ao processar request", message);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: message
          }
        ]
      };
    }
  }
);
server.tool(
  "delegate.tests",
  {
    description: "Gera comandos e arquivos de teste determin\xEDsticos.",
    inputSchema: {
      type: "object",
      properties: {
        instructions: {
          type: "string",
          description: "Objetivo e escopo dos testes."
        },
        context: { type: "string" },
        language: { type: "string" },
        framework: { type: "string" },
        tier: { type: "string" },
        temperature: { type: "number" },
        forceModel: { type: "string" },
        maxOutputTokens: { type: "number" }
      },
      required: ["instructions"],
      additionalProperties: false
    }
  },
  async ({ input }) => {
    try {
      const result = await executeDelegateTests(input, delegateContext);
      logDelegateResult("delegate.tests", result.result);
      return buildToolResponse(result.result, result.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("delegate.tests: falha ao processar request", message);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: message
          }
        ]
      };
    }
  }
);
server.tool(
  "delegate.docs",
  {
    description: "Produz documenta\xE7\xE3o concisa em Markdown.",
    inputSchema: {
      type: "object",
      properties: {
        instructions: {
          type: "string",
          description: "Diretrizes para o documento."
        },
        context: { type: "string" },
        audience: { type: "string" },
        tone: { type: "string" },
        language: { type: "string" },
        tier: { type: "string" },
        temperature: { type: "number" },
        forceModel: { type: "string" },
        maxOutputTokens: { type: "number" }
      },
      required: ["instructions"],
      additionalProperties: false
    }
  },
  async ({ input }) => {
    try {
      const result = await executeDelegateDocs(input, delegateContext);
      logDelegateResult("delegate.docs", result.result);
      return buildToolResponse(result.result, result.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("delegate.docs: falha ao processar request", message);
      const normalizedError = normalizeError(error);
      logger.error("delegate.run: falha ao processar request", normalizedError);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: normalizedError.message
          }
        ],
        metadata: {
          error: normalizedError
        }
      };
    }
  }
);
function buildToolResponse(result, overrideText) {
  const text = overrideText ?? result.text;
  return {
    content: [
      {
        type: "text",
        text
      }
    ],
    metadata: {
      decision: result.decision,
      parameters: result.parameters,
      rationale: result.rationale,
      usage: result.usage,
      cost: result.cost,
      meta: result.meta
    }
  };
}
function logDelegateResult(tool, result) {
  if (result.meta.fallback_used) {
    const attempts = result.meta.attempts.map((attempt) => `${attempt.provider}/${attempt.model}:${attempt.success ? "ok" : "fail"}`).join(", ");
    logger.warn(`${tool}: fallback utilizado`, attempts);
  } else {
    logger.info(`${tool}: rota principal executada`, `${result.decision.provider}/${result.decision.model}`);
  }
}
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
void main().catch((error) => {
  const normalizedError = normalizeError(error);
  logger.error("mcp.startup_failed", normalizedError);
  throw error;
});
function normalizeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name
    };
  }
  return { message: String(error) };
}
//# sourceMappingURL=index.js.map