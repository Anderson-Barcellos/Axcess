import { run, type DelegateContext, type DelegateResult } from '../delegate';
import type { RouteMetadata, RouteRequest } from '../router';

export interface DiffFileContext {
  path: string;
  contents: string;
}

export interface DelegateDiffInput {
  instructions: string;
  context?: string;
  files?: DiffFileContext[];
  language?: string;
  tier?: string;
  temperature?: number;
  forceModel?: string;
  maxOutputTokens?: number;
}

export interface ToolExecutionResult {
  text: string;
  result: DelegateResult;
}

function buildFileContext(files: DiffFileContext[] | undefined): string {
  if (!files?.length) {
    return '';
  }

  const rendered = files
    .map((file) => {
      const header = `File: ${file.path}`;
      const separator = '-'.repeat(header.length);
      const body = file.contents.trimEnd();
      return `${header}\n${separator}\n${body}`;
    })
    .join('\n\n');

  return `\nProvided files:\n${rendered}`;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fencePattern = /^```[a-zA-Z0-9:-]*\n([\s\S]*?)\n```$/;
  const match = trimmed.match(fencePattern);
  if (match) {
    return match[1].trim();
  }
  return trimmed;
}

function validateDiffOutput(diffText: string): void {
  if (!diffText.startsWith('diff --git ')) {
    throw new Error('delegate.diff: resposta não contém patch unificado iniciando com "diff --git".');
  }
  if (!diffText.includes('\n@@')) {
    throw new Error('delegate.diff: patch sem hunks @@ inválido.');
  }
}

function buildPrompt(input: DelegateDiffInput): string {
  const baseInstructions = [
    'You are delegate.diff, an assistant that returns Git patches.',
    'Respond with a unified diff using "diff --git" headers and @@ hunks.',
    'Do not include explanations, commentary, or code fences.',
    'Only include files that actually change.',
    'Use LF line endings and preserve existing indentation.',
    'If no change is required, return an empty diff that only contains diff --git headers with no modifications.',
  ].join('\n');

  const supplementalContext = input.context ? `\nAdditional context:\n${input.context.trim()}` : '';
  const fileContext = buildFileContext(input.files);

  return `${baseInstructions}${supplementalContext}${fileContext}\n\nUser instructions:\n${input.instructions.trim()}\n`;
}

function buildRouteRequest(input: DelegateDiffInput, prompt: string): RouteRequest {
  const metadata: RouteMetadata = {
    language: input.language,
    domain: 'code',
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

export async function executeDelegateDiff(input: DelegateDiffInput, context: DelegateContext): Promise<ToolExecutionResult> {
  if (!input?.instructions?.trim()) {
    throw new Error('delegate.diff: campo "instructions" é obrigatório.');
  }

  const prompt = buildPrompt(input);
  const request = buildRouteRequest(input, prompt);
  const runResult = await run(request, context);
  const sanitized = stripCodeFences(runResult.text);
  validateDiffOutput(sanitized);

  const result: DelegateResult = {
    ...runResult,
    text: sanitized,
  };

  return {
    text: sanitized,
    result,
  };
}
