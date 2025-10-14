import { run, type DelegateContext, type DelegateResult } from '../delegate';
import type { RouteMetadata, RouteRequest } from '../router';

export interface DelegateDocsInput {
  instructions: string;
  context?: string;
  audience?: string;
  tone?: string;
  language?: string;
  tier?: string;
  temperature?: number;
  forceModel?: string;
  maxOutputTokens?: number;
}

export interface DocsToolResult {
  text: string;
  result: DelegateResult;
}

function buildPrompt(input: DelegateDocsInput): string {
  const rules = [
    'You are delegate.docs, a technical writer producing concise Markdown.',
    'Return a short document under 200 lines.',
    'Begin with a single H1 heading summarizing the document.',
    'Organize content into focused sections using H2 or H3 headings.',
    'Avoid introductions, apologies, or filler text.',
    'Use bullet lists only when conveying steps or key points.',
    'Do not include code fences unless strictly necessary for snippets.',
  ].join('\n');

  const audienceLine = input.audience ? `\nTarget audience: ${input.audience.trim()}.` : '';
  const toneLine = input.tone ? `\nTone: ${input.tone.trim()}.` : '';
  const extraContext = input.context ? `\nContext:\n${input.context.trim()}` : '';

  return `${rules}${audienceLine}${toneLine}${extraContext}\n\nUser instructions:\n${input.instructions.trim()}\n`;
}

function buildRouteRequest(input: DelegateDocsInput, prompt: string): RouteRequest {
  const metadata: RouteMetadata = {
    language: input.language,
    domain: 'default',
    tier: input.tier,
    temperature: input.temperature,
  };

  const caps = typeof input.maxOutputTokens === 'number' && input.maxOutputTokens > 0
    ? { maxOutputTokens: input.maxOutputTokens }
    : undefined;

  return {
    prompt,
    forceModel: input.forceModel,
    metadata,
    caps,
  };
}

function sanitizeDocsOutput(text: string): string {
  return text.trim();
}

function validateDocsOutput(text: string): void {
  if (!text.startsWith('# ')) {
    throw new Error('delegate.docs: documento deve iniciar com heading H1.');
  }
  const lineCount = text.split(/\r?\n/).length;
  if (lineCount > 200) {
    throw new Error('delegate.docs: documento excedeu o limite de 200 linhas.');
  }
}

export async function executeDelegateDocs(input: DelegateDocsInput, context: DelegateContext): Promise<DocsToolResult> {
  if (!input?.instructions?.trim()) {
    throw new Error('delegate.docs: campo "instructions" é obrigatório.');
  }

  const prompt = buildPrompt(input);
  const request = buildRouteRequest(input, prompt);
  const runResult = await run(request, context);
  const sanitized = sanitizeDocsOutput(runResult.text);
  validateDocsOutput(sanitized);

  const result: DelegateResult = {
    ...runResult,
    text: sanitized,
  };

  return {
    text: sanitized,
    result,
  };
}
