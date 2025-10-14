import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { DelegateContext, ProviderHandler } from '../src/delegate';
import { executeDelegateDiff } from '../src/tools/diff';
import { executeDelegateTests } from '../src/tools/tests';
import { executeDelegateDocs } from '../src/tools/docs';

function createContext(outputText: string): DelegateContext {
  const provider: ProviderHandler = async () => ({
    outputText,
    usage: {
      inputTokens: 180,
      outputTokens: 60,
      totalTokens: 240,
    },
  });

  return {
    providers: {
      openai: provider,
    },
  };
}

test('delegate.diff normaliza resposta para patch unificado', async () => {
  const output = '```diff\ndiff --git a/app.ts b/app.ts\n@@\n+const answer = 42;\n```\n';
  const context = createContext(output);
  const result = await executeDelegateDiff(
    {
      instructions: 'Adicione uma constante answer = 42.',
      files: [
        {
          path: 'app.ts',
          contents: 'export function demo() {\n  return 0;\n}',
        },
      ],
      language: 'typescript',
    },
    context,
  );

  assert.ok(result.text.startsWith('diff --git a/app.ts b/app.ts'));
  assert.ok(!result.text.includes('```'));
  assert.equal(result.result.text, result.text);
  assert.equal(result.result.meta.fallback_used, false);
});

test('delegate.diff rejeita saída sem patch válido', async () => {
  const context = createContext('Sem alterações necessárias.');
  await assert.rejects(
    () =>
      executeDelegateDiff(
        {
          instructions: 'Nenhuma alteração.',
        },
        context,
      ),
    /patch unificado/,
  );
});

test('delegate.tests exige comandos e arquivos', async () => {
  const output = [
    '## Commands',
    '- `pnpm test -- --runInBand`',
    '',
    '## Files',
    '```test/sample.test.ts',
    "import { strict as assert } from 'node:assert';",
    '',
    'test("demo", () => {',
    '  assert.equal(1 + 1, 2);',
    '});',
    '```',
  ].join('\n');

  const context = createContext(output);
  const result = await executeDelegateTests(
    {
      instructions: 'Escreva testes unitários básicos.',
      framework: 'vitest',
    },
    context,
  );

  assert.ok(result.text.includes('## Commands'));
  assert.ok(result.text.includes('## Files'));
  assert.ok(result.text.includes('`pnpm test'));
});

test('delegate.docs retorna markdown enxuto com heading', async () => {
  const output = [
    '# Guia Rápido',
    '',
    '## Instalação',
    'Explique como instalar.',
    '',
    '## Uso',
    'Mostre exemplos breves.',
    '',
  ].join('\n');

  const context = createContext(`${output}\n\n`);
  const result = await executeDelegateDocs(
    {
      instructions: 'Documente o fluxo principal.',
      audience: 'Desenvolvedores experientes',
    },
    context,
  );

  assert.ok(result.text.startsWith('# Guia Rápido'));
  assert.equal(result.text.endsWith('\n'), false);
});
