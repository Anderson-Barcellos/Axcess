import { run, type DelegateContext, type DelegateResult } from '../delegate';
import type { RouteMetadata, RouteRequest } from '../router';

export interface DelegateTestsInput {
  instructions: string;
  context?: string;
  language?: string;
  framework?: string;
  tier?: string;
  temperature?: number;
  forceModel?: string;
  maxOutputTokens?: number;
}

export interface TestsToolResult {
  text: string;
  result: DelegateResult;
}

function buildPrompt(input: DelegateTestsInput): string {
  const rules = [
    'You are delegate.tests, an assistant that designs deterministic testing plans.',
    'Return Markdown with exactly two sections: "## Commands" and "## Files" in this order.',
    'In "## Commands" list shell commands using bullet points with inline code.',
    'In "## Files" provide one or more fenced code blocks labelled with the file path, like ```path/to/file.ext`.',
    'Use deterministic seeds and avoid external services.',
    'Do not add commentary outside of these sections.',
  ].join('\n');

  const frameworkNote = input.framework ? `\nPreferred framework: ${input.framework.trim()}.` : '';
  const extraContext = input.context ? `\nContext:\n${input.context.trim()}` : '';

  return `${rules}${frameworkNote}${extraContext}\n\nUser instructions:\n${input.instructions.trim()}\n`;
}

function buildRouteRequest(input: DelegateTestsInput, prompt: string): RouteRequest {
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

function sanitizeOutput(text: string): string {
  return text.trim();
}

function validateTestsOutput(text: string): void {
  if (!/^## Commands/m.test(text)) {
    throw new Error('delegate.tests: seção "## Commands" ausente.');
  }
  if (!/^## Files/m.test(text)) {
    throw new Error('delegate.tests: seção "## Files" ausente.');
  }
  const filesIndex = text.indexOf('## Files');
  const commandsSegment = filesIndex >= 0 ? text.slice(0, filesIndex) : text;
  if (!/`[^`\n]+`/.test(commandsSegment)) {
    throw new Error('delegate.tests: nenhuma linha de comando detectada na seção Commands.');
  }
  const filesSection = filesIndex >= 0 ? text.slice(filesIndex) : '';
  if (!/```[^\n]*\n[\s\S]+?```/m.test(filesSection)) {
    throw new Error('delegate.tests: nenhuma code block de arquivo detectada.');
  }
}

export async function executeDelegateTests(input: DelegateTestsInput, context: DelegateContext): Promise<TestsToolResult> {
  if (!input?.instructions?.trim()) {
    throw new Error('delegate.tests: campo "instructions" é obrigatório.');
  }

  const prompt = buildPrompt(input);
  const request = buildRouteRequest(input, prompt);
  const runResult = await run(request, context);
  const sanitized = sanitizeOutput(runResult.text);
  validateTestsOutput(sanitized);

  const result: DelegateResult = {
    ...runResult,
    text: sanitized,
  };

  return {
    text: sanitized,
    result,
  };
}
