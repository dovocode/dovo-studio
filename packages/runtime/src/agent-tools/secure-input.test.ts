import { afterEach, expect, it, vi } from 'vite-plus/test'
import { sealSecureInput, type SecureInputStatus, type SecureInputRequest } from '@dovo/protocol'
import { SecureInputs } from './secure-input.js'

const stores: SecureInputs[] = []
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close()
  vi.useRealTimers()
})
const request: SecureInputRequest = {
  key: 'credential',
  title: 'Sign in',
  prompt: 'Enter your private value',
  destination: { kind: 'command', command: '/fixture/consumer', args: [], appendNewline: false },
}
function setup() {
  const reports =
    vi.fn<(taskId: string, runId: string, id: string, status: SecureInputStatus) => void>()
  const changed = vi.fn<() => void>()
  const store = new SecureInputs(changed, reports)
  stores.push(store)
  const controller = new AbortController()
  return { store, reports, changed, controller }
}
it('encrypts exact private text and exposes only status through requests, lists and reports', async () => {
  const { store, reports, controller } = setup()
  const consume = vi.fn<(value: string, signal: AbortSignal) => Promise<void>>(
    async (_value: string, _signal: AbortSignal) => {},
  )
  const result = store.request('thread', 'run', request, '/fixture', controller.signal, consume)
  const info = store.list()[0]
  const secret = '  synthetic/private-callback?code=confidential&state=private\n'
  const envelope = sealSecureInput(info, secret)
  expect(JSON.stringify(envelope)).not.toContain(secret)
  expect(await store.submit(envelope, 'phone')).toEqual({ id: result.id, status: 'completed' })
  expect(consume.mock.calls[0][0]).toBe(secret)
  expect(store.list()).toEqual([])
  expect(reports).toHaveBeenCalledExactlyOnceWith('thread', 'run', result.id, 'completed')
  expect(
    JSON.stringify([result, reports.mock.calls, store.status('thread', result.id)]),
  ).not.toContain(secret)
  expect(store.replay('thread', 'run', request)).toEqual({ id: result.id, status: 'completed' })
  expect(() => store.replay('thread', 'run', { ...request, prompt: 'Changed' })).toThrow(
    'key is already in use',
  )
})
it('admits one consumer across concurrent requests, lost replies and device replay', async () => {
  const { store, controller } = setup()
  let finish!: () => void
  const consume = vi.fn<(value: string, signal: AbortSignal) => Promise<void>>(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  store.request('thread', 'run', request, '/fixture', controller.signal, consume)
  const info = store.list()[0]
  const envelope = sealSecureInput(info, 'synthetic-value')
  const first = store.submit(envelope, 'phone')
  await Promise.resolve()
  expect(await store.submit(envelope, 'phone')).toEqual({ id: info.id, status: 'running' })
  await expect(store.submit(envelope, 'other-phone')).rejects.toThrow('already been submitted')
  await expect(store.submit(sealSecureInput(info, 'other-value'), 'phone')).rejects.toThrow(
    'already been submitted',
  )
  finish()
  await first
  expect(await store.submit(envelope, 'phone')).toEqual({ id: info.id, status: 'completed' })
  expect(consume).toHaveBeenCalledTimes(1)
})
it('rejects tampering, wrong task binding and cross-request ciphertext without invoking a consumer', async () => {
  const { store, controller } = setup()
  const consume = vi.fn<(value: string, signal: AbortSignal) => Promise<void>>(
    async (_value: string, _signal: AbortSignal) => {},
  )
  store.request('thread', 'run', request, '/fixture', controller.signal, consume)
  const info = store.list()[0]
  const envelope = sealSecureInput(info, 'synthetic-secret')
  const tampered = {
    ...envelope,
    box: { ...envelope.box, ciphertext: '00' + envelope.box.ciphertext.slice(2) },
  }
  await expect(store.submit(tampered, 'phone')).rejects.toThrow('could not be authenticated')
  const wrongTask = sealSecureInput({ ...info, taskId: 'other' }, 'synthetic-secret')
  await expect(store.submit(wrongTask, 'phone')).rejects.toThrow('could not be authenticated')
  const other = store.request(
    'thread',
    'run',
    { ...request, key: 'other' },
    '/fixture',
    controller.signal,
    consume,
  )
  await expect(store.submit({ ...envelope, id: other.id }, 'phone')).rejects.toThrow(
    'could not be authenticated',
  )
  expect(() => store.status('other', info.id)).toThrow('another thread')
  expect(consume).not.toHaveBeenCalled()
  expect((await store.submit(envelope, 'phone')).status).toBe('completed')
})
it('keeps consumer errors private and retries status delivery without repeating the consumer', async () => {
  const { store, controller, reports } = setup()
  const secret = 'synthetic-sensitive-error'
  const consume = vi.fn<(value: string, signal: AbortSignal) => Promise<void>>(
    async (_value: string, _signal: AbortSignal) => {
      throw new Error(secret)
    },
  )
  reports.mockImplementationOnce(() => {
    throw new Error('Storage unavailable')
  })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    store.request('thread', 'run', request, '/fixture', controller.signal, consume)
    const envelope = sealSecureInput(store.list()[0], secret)
    expect((await store.submit(envelope, 'phone')).status).toBe('failed')
    expect((await store.submit(envelope, 'phone')).status).toBe('failed')
    expect(consume).toHaveBeenCalledTimes(1)
    expect(JSON.stringify([reports.mock.calls, log.mock.calls])).not.toContain(secret)
  } finally {
    log.mockRestore()
  }
})
it('expires requests, rejects late entry, and never resumes a stopped turn', async () => {
  vi.useFakeTimers()
  const { store, controller, reports } = setup()
  const consume = vi.fn<(value: string, signal: AbortSignal) => Promise<void>>(
    async (_value: string, _signal: AbortSignal) => {},
  )
  const first = store.request('thread', 'run', request, '/fixture', controller.signal, consume)
  const envelope = sealSecureInput(store.list()[0], 'synthetic-secret')
  await vi.advanceTimersByTimeAsync(10 * 60_000)
  expect((await store.submit(envelope, 'phone')).status).toBe('expired')
  expect(reports).toHaveBeenCalledWith('thread', 'run', first.id, 'expired')
  const second = store.request('thread', 'next', request, '/fixture', controller.signal, consume)
  controller.abort()
  expect(store.status('thread', second.id).status).toBe('cancelled')
  expect(reports).toHaveBeenCalledTimes(1)
  expect(consume).not.toHaveBeenCalled()
})
it('cancels running delivery and drains consumers before shutdown', async () => {
  const { store, controller, reports } = setup()
  let stopped = false
  const consume = vi.fn<(value: string, signal: AbortSignal) => Promise<void>>(
    (_value: string, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            stopped = true
            resolve()
          },
          { once: true },
        )
      }),
  )
  store.request('thread', 'run', request, '/fixture', controller.signal, consume)
  const delivery = store.submit(sealSecureInput(store.list()[0], 'synthetic-value'), 'phone')
  await Promise.resolve()
  await store.close()
  expect(stopped).toBe(true)
  expect((await delivery).status).toBe('cancelled')
  expect(reports).not.toHaveBeenCalled()
})
it('supports escaped values at the UTF-8 size limit and rejects oversized input before transport', async () => {
  const { store, controller } = setup()
  const consume = vi.fn<(value: string, signal: AbortSignal) => Promise<void>>(
    async (_value: string, _signal: AbortSignal) => {},
  )
  store.request('thread', 'run', request, '/fixture', controller.signal, consume)
  const info = store.list()[0]
  expect(() => sealSecureInput(info, '🔐'.repeat(2049))).toThrow('8192')
  const value = '\u0000'.repeat(8192)
  expect((await store.submit(sealSecureInput(info, value), 'phone')).status).toBe('completed')
  expect(consume.mock.calls[0][0]).toBe(value)
})
