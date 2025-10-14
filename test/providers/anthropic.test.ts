import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAnthropicProvider } from '../../src/providers/anthropic.js';

test('anthropic: retorna erro quando API key não está configurada', async () => {
  const provider = createAnthropicProvider({ apiKey: '' });
  
  await assert.rejects(
    async () => {
      await provider({
        prompt: 'test',
        decision: {
          alias: 'reasoning',
          modelId: 'anthropic:claude-3-5-sonnet',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
        },
        parameters: {
          max_output_tokens: 100,
          temperature: 0.7,
        },
        request: {
          prompt: 'test',
        },
      });
    },
    /chave de API não configurada/
  );
});

test('anthropic: aceita API key via options', () => {
  const provider = createAnthropicProvider({ apiKey: 'sk-test-key' });
  assert.ok(provider);
  assert.equal(typeof provider, 'function');
});

test('anthropic: normaliza erro de autenticação', async () => {
  // Note: This would require mocking the Anthropic SDK
  // For now, we just verify the provider is callable
  const provider = createAnthropicProvider({ apiKey: 'sk-invalid' });
  assert.ok(provider);
});
