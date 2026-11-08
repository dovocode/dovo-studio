import { expect, it } from 'vite-plus/test'
import { claudeProviderRetry, providerRetryLabel } from './provider-retry'

it('validates provider retry frames and describes recovery and terminal outcomes', () => {
  const event = {
    type: 'system',
    subtype: 'api_retry',
    attempt: 2,
    max_retries: 5,
    retry_delay_ms: 1250,
    error_status: 429,
  }
  const retry = claudeProviderRetry(event)!
  expect(providerRetryLabel({ providerRetry: retry, status: 'running' })).toBe(
    'HTTP 429 · automatic retry 2 of 5 · retry delay 2s',
  )
  expect(
    providerRetryLabel({ providerRetry: { ...retry, state: 'recovered' }, status: 'running' }),
  ).toBe('Connection recovered after automatic retry')
  expect(providerRetryLabel({ providerRetry: retry, status: 'cancelled' })).toBe(
    'Stopped after automatic retry',
  )
  expect(providerRetryLabel({ providerRetry: retry, status: 'failed' })).toBe(
    'Turn failed after automatic retry',
  )
  expect(providerRetryLabel({ providerRetry: retry, status: 'completed' })).toBe(
    'Connection recovered after automatic retry',
  )
  expect(providerRetryLabel({ status: 'running' })).toBeUndefined()
  expect(claudeProviderRetry({ ...event, error_status: null })?.httpStatus).toBeUndefined()
  for (const invalid of [
    {},
    { ...event, subtype: 'other' },
    { ...event, attempt: -1 },
    { ...event, retry_delay_ms: Infinity },
    { ...event, retry_delay_ms: '1000' },
  ])
    expect(claudeProviderRetry(invalid)).toBeUndefined()
})
