import { expect, it, vi } from 'vite-plus/test'
import {
  clientDiagnostic,
  diagnosticMessage,
  redactCredentialText,
  recordClientAction,
  recentClientActions,
  recordClientError,
  recentClientErrors,
  clientRequestCategory,
} from './client-diagnostics'

it('keeps a bounded category-only timeline and expires it after thirty minutes', () => {
  vi.useFakeTimers()
  try {
    vi.setSystemTime(new Date('2030-01-01T12:00:00Z'))
    for (let i = 0; i < 110; i++) recordClientAction('navigation', 'app', { durationMs: i })
    expect(recentClientActions()).toHaveLength(100)
    expect(recentClientActions()[0].durationMs).toBe(10)
    const details = {
      durationMs: Infinity,
      status: 700,
      body: 'private input',
      address: 'http://private',
    }
    recordClientAction('request-failed', 'scm', details)
    expect(recentClientActions().at(-1)).toEqual({
      at: '2030-01-01T12:00:00.000Z',
      action: 'request-failed',
      category: 'scm',
    })
    recordClientAction('request-complete', 'files', { durationMs: -4, status: 200 })
    expect(recentClientActions().at(-1)).toMatchObject({ durationMs: 0, status: 200 })
    const copy = recentClientActions()
    copy[0].category = 'other'
    expect(recentClientActions()[0].category).toBe('app')
    vi.advanceTimersByTime(30 * 60000 + 1)
    expect(recentClientActions()).toEqual([])
    expect(clientRequestCategory('/api/tasks/private-thread?secret=value')).toBe('threads')
  } finally {
    vi.useRealTimers()
  }
})

it('redacts structured error stacks before retaining them in memory', () => {
  const error = new TypeError('request failed token=message-secret')
  error.stack =
    'TypeError: token=message-secret\n at request (https://user:pass@host/app?token=query-secret#private)\n api_key=stack-secret'
  recordClientError(error, 'request')
  const saved = recentClientErrors().at(-1)
  expect(saved?.name).toBe('TypeError')
  expect(saved?.stack).toContain('https://host/app')
  for (const value of ['message-secret', 'query-secret', 'stack-secret', 'user:pass'])
    expect(JSON.stringify(saved)).not.toContain(value)
})
it('removes credentials and URL query/fragment from copyable diagnostics', () => {
  const value = diagnosticMessage(
    new Error(
      'Failed http://user:pass@computer:4321/api?token=private#secret Bearer abc123 password="private words" api_key=key123 "access_token":"json-secret"',
    ),
  )
  expect(value).toContain('http://computer:4321/api')
  for (const secret of ['user:pass', 'private', 'abc123', 'key123', '#secret', 'json-secret'])
    expect(value).not.toContain(secret)
})
it('includes a bounded error, a stable identifier and only supplied context', () => {
  const value = clientDiagnostic('x'.repeat(3000), { appVersion: '1.0', surface: 'mobile' })
  expect(value.id).toBeTruthy()
  expect(Number.isFinite(Date.parse(value.at))).toBe(true)
  expect(value.context).toEqual({ appVersion: '1.0', surface: 'mobile' })
  expect(value.error).toHaveLength(2000)
})

it('redacts Basic authorization, API key headers and quoted embedded JSON without losing surrounding text', () => {
  const text =
    'request X-API-Key: header-secret Authorization: Basic dXNlcjpwYXNz {"api_key":"json-secret","password":"two words"} done'
  const redacted = redactCredentialText(text)
  for (const secret of ['header-secret', 'dXNlcjpwYXNz', 'json-secret', 'two words'])
    expect(redacted).not.toContain(secret)
  expect(redacted).toContain('request')
  expect(redacted).toContain('done')
  expect(redactCredentialText(redacted)).toBe(redacted)
  expect(redactCredentialText('token count: 12 exitCode=1')).toBe('token count: 12 exitCode=1')
})

it('bounds and redacts an optional component stack without truncating the error', () => {
  const stack =
    '\n at View (https://user:pass@host/view?token=query-secret#hash) Bearer credential password="stack-secret"\n' +
    'x'.repeat(3000)
  const value = clientDiagnostic('Original failure', { viewId: 'tasks' }, stack)
  expect(value.error).toBe('Original failure')
  expect(value.componentStack).toHaveLength(2000)
  expect(value.componentStack).toContain('at View (https://host/view')
  for (const secret of ['user:pass', 'query-secret', '#hash', 'credential', 'stack-secret'])
    expect(value.componentStack).not.toContain(secret)
  expect(clientDiagnostic('failure')).not.toHaveProperty('componentStack')
  expect(clientDiagnostic('failure', {}, null)).not.toHaveProperty('componentStack')
})

it('removes URL credentials for any scheme, private keys and command-line secrets', () => {
  const text = [
    'postgres://dovo:pg-secret@db:5432/app',
    'redis://:redis-secret@cache:6379',
    'mongodb+srv://dovo:mongo-secret@cluster0.example.net/app',
    'git clone https://dovo:git-secret@example.com/repo.git',
    '--api-key cli-secret --token "quoted secret" passwd=pw-secret',
    '-----BEGIN PRIVATE KEY----- MC4CAQAwBQYDK2VwBCIEIBn+key/body== -----END PRIVATE KEY-----',
  ].join('\n')
  const redacted = redactCredentialText(text)
  for (const secret of [
    'pg-secret',
    'redis-secret',
    'mongo-secret',
    'git-secret',
    'cli-secret',
    'quoted secret',
    'pw-secret',
    'MC4CAQAw',
  ])
    expect(redacted).not.toContain(secret)
  for (const kept of [
    'postgres://db:5432/app',
    'redis://cache:6379',
    'mongodb+srv://cluster0.example.net/app',
    'https://example.com/repo.git',
    '--api-key [redacted] --token "[redacted]"',
  ])
    expect(redacted).toContain(kept)
  expect(redactCredentialText(redacted)).toBe(redacted)
})
