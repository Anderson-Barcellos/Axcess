import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvidersFromEnv, createDelegateContext } from '../../src/providers/index.js';

test('registry: createProvidersFromEnv retorna todos os providers', () => {
  const providers = createProvidersFromEnv({
    openaiApiKey: 'sk-test-openai',
    anthropicApiKey: 'sk-test-anthropic',
    googleApiKey: 'test-google',
  });

  assert.ok(providers.openai);
  assert.ok(providers.anthropic);
  assert.ok(providers.google);
  assert.equal(typeof providers.openai, 'function');
  assert.equal(typeof providers.anthropic, 'function');
  assert.equal(typeof providers.google, 'function');
});

test('registry: createDelegateContext cria contexto com providers', () => {
  const context = createDelegateContext();
  
  assert.ok(context);
  assert.ok(context.providers);
  assert.ok(context.providers.openai);
  assert.ok(context.providers.anthropic);
  assert.ok(context.providers.google);
});

test('registry: createDelegateContext aceita logger customizado', () => {
  const logs: string[] = [];
  const logger = {
    info: (...args: unknown[]) => logs.push(args.join(' ')),
  };

  const context = createDelegateContext(logger);
  
  assert.ok(context);
  assert.equal(context.logger, logger);
});

test('registry: providers aceitam API keys do ambiente', () => {
  // Test that providers can be created without explicit keys
  const providers = createProvidersFromEnv();
  
  assert.ok(providers.openai);
  assert.ok(providers.anthropic);
  assert.ok(providers.google);
});
