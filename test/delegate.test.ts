import assert from 'node:assert/strict';
import { test } from 'node:test';

import { run, ProviderHandler } from '../src/delegate.ts';
import { RouteRequest } from '../src/router.ts';

test('run aplica fallback quando apenas totalTokens está presente', async () => {
  const logs: string[] = [];
  const provider: ProviderHandler = async () => ({
    outputText: 'resposta',
    usage: {
      totalTokens: 150,
    },
  });

  const request: RouteRequest = {
    prompt: 'Olá, mundo!'
  };

  const result = await run(request, {
    providers: {
      openai: provider,
    },
    logger: {
      debug: (...args: unknown[]) => {
        logs.push(args.map((value) => String(value)).join(' '));
      },
      info: () => {},
    },
  });

  assert.equal(result.usage.input_tokens, 150);
  assert.equal(result.usage.output_tokens, 0);
  assert.equal(result.usage.total_tokens, 150);
  assert.equal(result.cost.input, 150 * 0.000003);
  assert.equal(result.cost.output, 0);
  assert.ok(result.rationale.some((entry) => entry.includes('apenas totalTokens')));
  assert.ok(logs.some((entry) => entry.includes('somente totalTokens')));
});
