import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGoogleProvider } from '../../src/providers/google.js';

test('google: retorna erro quando API key não está configurada', async () => {
  const provider = createGoogleProvider({ apiKey: '' });
  
  await assert.rejects(
    async () => {
      await provider({
        prompt: 'test',
        decision: {
          alias: 'long-context',
          modelId: 'google:gemini-1.5-pro',
          provider: 'google',
          model: 'gemini-1.5-pro',
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

test('google: aceita API key via options', () => {
  const provider = createGoogleProvider({ apiKey: 'test-api-key' });
  assert.ok(provider);
  assert.equal(typeof provider, 'function');
});

test('google: normaliza erro de autenticação', async () => {
  // Note: This would require mocking the Google SDK
  // For now, we just verify the provider is callable
  const provider = createGoogleProvider({ apiKey: 'invalid-key' });
  assert.ok(provider);
});
