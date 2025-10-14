import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeRequest } from '../../src/router.js';

test('router: resolve alias para provider anthropic', () => {
  const result = routeRequest({
    prompt: 'Test prompt',
    forceModel: 'reasoning',
  });

  assert.equal(result.decision.alias, 'reasoning');
  assert.equal(result.decision.provider, 'anthropic');
  assert.equal(result.decision.model, 'claude-3-5-sonnet');
  assert.equal(result.decision.modelId, 'anthropic:claude-3-5-sonnet');
});

test('router: resolve alias para provider google', () => {
  const result = routeRequest({
    prompt: 'Test prompt',
    forceModel: 'long-context',
  });

  assert.equal(result.decision.alias, 'long-context');
  assert.equal(result.decision.provider, 'google');
  assert.equal(result.decision.model, 'gemini-1.5-pro');
  assert.equal(result.decision.modelId, 'google:gemini-1.5-pro');
});

test('router: resolve model ID direto para anthropic', () => {
  const result = routeRequest({
    prompt: 'Test prompt',
    forceModel: 'anthropic:claude-3-5-sonnet',
  });

  assert.equal(result.decision.provider, 'anthropic');
  assert.equal(result.decision.model, 'claude-3-5-sonnet');
  assert.equal(result.decision.modelId, 'anthropic:claude-3-5-sonnet');
});

test('router: resolve model ID direto para google', () => {
  const result = routeRequest({
    prompt: 'Test prompt',
    forceModel: 'google:gemini-1.5-pro',
  });

  assert.equal(result.decision.provider, 'google');
  assert.equal(result.decision.model, 'gemini-1.5-pro');
  assert.equal(result.decision.modelId, 'google:gemini-1.5-pro');
});

test('router: inclui fallbacks quando disponíveis', () => {
  const result = routeRequest({
    prompt: 'Test prompt',
  });

  assert.ok(result.decision);
  assert.ok(Array.isArray(result.fallbacks));
  // Fallbacks may or may not be configured, just verify structure
});

test('router: aplica temperatura e caps corretamente', () => {
  const result = routeRequest({
    prompt: 'Test prompt',
    forceModel: 'reasoning',
    metadata: {
      temperature: 0.5,
    },
  });

  assert.equal(result.parameters.temperature, 0.5);
  assert.ok(result.parameters.max_output_tokens > 0);
});
