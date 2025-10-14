import { Server } from '@modelcontextprotocol/sdk/server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/stdio.js';
import { run, type DelegateContext, type DelegateResult } from './delegate';
import type { RouteRequest } from './router';
import { createOpenAIProvider } from './providers/openai';

const logger = {
  debug: (...args: unknown[]) => console.debug('[axcess]', ...args),
  info: (...args: unknown[]) => console.info('[axcess]', ...args),
  warn: (...args: unknown[]) => console.warn('[axcess]', ...args),
  error: (...args: unknown[]) => console.error('[axcess]', ...args),
};

function createDelegateContext(): DelegateContext {
  return {
    providers: {
      openai: createOpenAIProvider(),
    },
    logger,
  };
}

const delegateContext = createDelegateContext();

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
      logDelegateResult(result);

      return {
        content: [
          {
            type: 'text',
            text: result.text,
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

function logDelegateResult(result: DelegateResult): void {
  if (result.meta.fallback_used) {
    const attempts = result.meta.attempts
      .map((attempt) => `${attempt.provider}/${attempt.model}:${attempt.success ? 'ok' : 'fail'}`)
      .join(', ');
    logger.warn('delegate.run: fallback utilizado', attempts);
  } else {
    logger.info('delegate.run: rota principal executada', `${result.decision.provider}/${result.decision.model}`);
  }
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  logger.error('Erro ao iniciar o servidor MCP:', error);
  process.exit(1);
});
