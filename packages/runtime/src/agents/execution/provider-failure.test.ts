import { expect, it } from 'vite-plus/test'
import { HttpError, RuntimeOperationError } from '../../errors.js'
import { explainProviderFailure, providerFailureKind, ProviderFailure } from './provider-failure.js'

it.each([
  ['401 authentication required', 'authentication'],
  ['invalid_api_key', 'authentication'],
  ['unsupported reasoning effort', 'configuration'],
  ['reasoning start before end', 'configuration'],
  ['MODEL_CAPACITY_EXHAUSTED 429', 'capacity'],
  ['No capacity available for model', 'capacity'],
  ['429 rate_limit_exceeded', 'quota'],
  ['quota exhausted', 'quota'],
  ['503 Provider unavailable', 'unavailable'],
  ['ETIMEDOUT', 'unavailable'],
  ['command failed with exit code 1', 'unknown'],
])('classifies %s as %s', (message, kind) => {
  expect(providerFailureKind(new Error(message))).toBe(kind)
})

it('preserves typed domain errors, existing explanations and unknown failures', () => {
  const rejected = new HttpError(401, 'Pairing required')
  expect(explainProviderFailure(rejected)).toBe(rejected)
  const unknown = new Error('unknown failure')
  expect(explainProviderFailure(unknown)).toBe(unknown)
  const explained = explainProviderFailure(
    new RuntimeOperationError({ cause: new Error('503 unavailable') }),
  )
  expect(explained).toBeInstanceOf(RuntimeOperationError)
  if (!(explained instanceof RuntimeOperationError)) throw new Error('Expected runtime error')
  expect(explained.cause).toBeInstanceOf(ProviderFailure)
  expect(explained.message).toContain('saved sign-in is kept')
  expect(explainProviderFailure(explained)).toBe(explained)
})
