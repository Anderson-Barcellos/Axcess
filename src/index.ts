import { Server } from '@modelcontextprotocol/sdk/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/stdio.js';
import { run, type DelegateContext, type DelegateResult } from './delegate';
import type { RouteRequest } from './router';
import { createOpenAIProvider } from './providers/openai';
import { executeDelegateDiff, type DelegateDiffInput } from './tools/diff';
import { executeDelegateTests, type DelegateTestsInput } from './tools/tests';
import { executeDelegateDocs, type DelegateDocsInput } from './tools/docs';
import { createDelegateContext as buildDelegateContext } from './providers';

const logger = {
  debug: (...args: unknown[]) => console.debug('[axcess]', ...args),
  info: (...args: unknown[]) => console.info('[axcess]', ...args),
  warn: (...args: unknown[]) => console.warn('[axcess]', ...args),
  error: (...args: unknown[]) => console.error('[axcess]', ...args),
};

const delegateContext: DelegateContext = buildDelegateContext(logger);

const server = new Server({
  name: 'axcess-mcp',
  version: '0.1.0',
});

server.tool(
  'delegate.run',
  {
    description: 'Roteia prompts para os modelos configurados e retorna a resposta.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Prompt a ser encaminhado para o roteador.',
        },
        forceModel: {
          type: 'string',
          description: 'Modelo ou alias forçado, ignorando heurísticas.',
        },
        metadata: {
          type: 'object',
          description: 'Metadados opcionais que ajudam no roteamento.',
          properties: {
            language: { type: 'string' },
            tier: { type: 'string' },
            domain: {
              type: 'string',
              enum: ['code', 'creative', 'default'],
            },
            temperature: { type: 'number' },
          },
          additionalProperties: false,
        },
        caps: {
          type: 'object',
          description: 'Limites adicionais para a requisição.',
          properties: {
            maxOutputTokens: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    const request: RouteRequest = {
      prompt: input.prompt,
      forceModel: input.forceModel,
      metadata: input.metadata,
      caps: input.caps,
    };

    try {
      const result = await run(request, delegateContext);
      logDelegateResult('delegate.run', result);

      return buildToolResponse(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('delegate.run: falha ao processar request', message);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
      };
    }
  }
);

server.tool(
  'delegate.diff',
  {
    description: 'Gera um patch unificado (diff --git) a partir de instruções de refatoração.',
    inputSchema: {
      type: 'object',
      properties: {
        instructions: {
          type: 'string',
          description: 'Instruções detalhadas para gerar o patch.',
        },
        context: { type: 'string' },
        files: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              contents: { type: 'string' },
            },
            required: ['path', 'contents'],
            additionalProperties: false,
          },
        },
        language: { type: 'string' },
        tier: { type: 'string' },
        temperature: { type: 'number' },
        forceModel: { type: 'string' },
        maxOutputTokens: { type: 'number' },
      },
      required: ['instructions'],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    try {
      const result = await executeDelegateDiff(input as DelegateDiffInput, delegateContext);
      logDelegateResult('delegate.diff', result.result);
      return buildToolResponse(result.result, result.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('delegate.diff: falha ao processar request', message);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
      };
    }
  }
);

server.tool(
  'delegate.tests',
  {
    description: 'Gera comandos e arquivos de teste determinísticos.',
    inputSchema: {
      type: 'object',
      properties: {
        instructions: {
          type: 'string',
          description: 'Objetivo e escopo dos testes.',
        },
        context: { type: 'string' },
        language: { type: 'string' },
        framework: { type: 'string' },
        tier: { type: 'string' },
        temperature: { type: 'number' },
        forceModel: { type: 'string' },
        maxOutputTokens: { type: 'number' },
      },
      required: ['instructions'],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    try {
      const result = await executeDelegateTests(input as DelegateTestsInput, delegateContext);
      logDelegateResult('delegate.tests', result.result);
      return buildToolResponse(result.result, result.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('delegate.tests: falha ao processar request', message);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
      };
    }
  }
);

server.tool(
  'delegate.docs',
  {
    description: 'Produz documentação concisa em Markdown.',
    inputSchema: {
      type: 'object',
      properties: {
        instructions: {
          type: 'string',
          description: 'Diretrizes para o documento.',
        },
        context: { type: 'string' },
        audience: { type: 'string' },
        tone: { type: 'string' },
        language: { type: 'string' },
        tier: { type: 'string' },
        temperature: { type: 'number' },
        forceModel: { type: 'string' },
        maxOutputTokens: { type: 'number' },
      },
      required: ['instructions'],
      additionalProperties: false,
    },
  },
  async ({ input }) => {
    try {
      const result = await executeDelegateDocs(input as DelegateDocsInput, delegateContext);
      logDelegateResult('delegate.docs', result.result);
      return buildToolResponse(result.result, result.text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('delegate.docs: falha ao processar request', message);
      const normalizedError = normalizeError(error);
      logger.error('delegate.run: falha ao processar request', normalizedError);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: normalizedError.message,
          },
        ],
        metadata: {
          error: normalizedError,
        },
      };
    }
  }
);

function buildToolResponse(result: DelegateResult, overrideText?: string) {
  const text = overrideText ?? result.text;
  return {
    content: [
      {
        type: 'text',
        text,
      },
    ],
    metadata: {
      decision: result.decision,
      parameters: result.parameters,
      rationale: result.rationale,
      usage: result.usage,
      cost: result.cost,
      meta: result.meta,
    },
  };
}

function logDelegateResult(tool: string, result: DelegateResult): void {
  if (result.meta.fallback_used) {
    const attempts = result.meta.attempts
      .map((attempt) => `${attempt.provider}/${attempt.model}:${attempt.success ? 'ok' : 'fail'}`)
      .join(', ');
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
  logger.error('mcp.startup_failed', normalizedError);
  throw error;
});

function normalizeError(error: unknown): { message: string; stack?: string; name?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }

  return { message: String(error) };
}
