/// <reference types="node" />
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { Worker } from 'node:worker_threads'
import { WorkspaceRouter } from './workspace-router'
import { runtimeIntegration } from '../../testing/integration'

vi.setConfig(runtimeIntegration)
afterEach(() => vi.useRealTimers())
function worker(body: string) {
  return new Worker(
    new URL(
      'data:text/javascript,' +
        encodeURIComponent(
          `import {parentPort} from 'node:worker_threads'; parentPort.on('message',message=>{${body}})`,
        ),
    ),
  )
}
it.each(['browser', 'terminal', 'thread'] as const)(
  'accepts a local %s suggestion without modifying the input',
  async (mode) => {
    const open = vi.fn<() => Worker>(() =>
      worker(
        `parentPort.postMessage({id:message.id,mode:${JSON.stringify(mode)},reason:message.text})`,
      ),
    )
    const router = new WorkspaceRouter(open)
    try {
      expect(await router.route('  pnpm test  ')).toEqual({ mode, reason: 'pnpm test' })
      expect(await router.route('git diff')).toEqual({ mode, reason: 'git diff' })
      expect(open).toHaveBeenCalledTimes(1)
    } finally {
      await router.dispose()
    }
  },
)
it.each([
  `parentPort.postMessage({id:message.id,mode:'execute',reason:'unexpected'})`,
  `parentPort.postMessage({id:message.id,mode:'terminal'})`,
  `throw new Error('native model failed')`,
  `process.exit(1)`,
])('falls back to a reviewable Thread when the worker fails: %s', async (body) => {
  const router = new WorkspaceRouter(() => worker(body))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    expect(await router.route('pnpm test')).toMatchObject({
      mode: 'thread',
      reason: expect.stringContaining('review'),
    })
  } finally {
    await router.dispose()
    log.mockRestore()
  }
})
it('bounds concurrent jobs and resolves pending suggestions on shutdown', async () => {
  const router = new WorkspaceRouter(() => worker(''))
  const pending = Array.from({ length: 4 }, () => router.route('pnpm test'))
  expect(await router.route('git diff')).toMatchObject({
    mode: 'thread',
    reason: expect.stringContaining('busy'),
  })
  await router.dispose()
  expect(await Promise.all(pending)).toHaveLength(4)
  expect((await router.route('git diff')).reason).toContain('shutting down')
})
it('terminates stalled inference before the normal HTTP deadline', async () => {
  vi.useFakeTimers()
  const router = new WorkspaceRouter(() => worker(''))
  try {
    const pending = router.route('pnpm test')
    await vi.advanceTimersByTimeAsync(25_001)
    expect(await pending).toMatchObject({
      mode: 'thread',
      reason: expect.stringContaining('timed out'),
    })
  } finally {
    await router.dispose()
  }
})
it('explains the input limit without truncating a paste or loading the model', async () => {
  const open = vi.fn<() => Worker>(() => worker(''))
  const router = new WorkspaceRouter(open)
  try {
    expect(await router.route('Review this file\n' + 'x'.repeat(3000))).toMatchObject({
      mode: 'thread',
      reason: expect.stringContaining('exceeds the local router limit'),
    })
    expect(open).not.toHaveBeenCalled()
  } finally {
    await router.dispose()
  }
})
it('unloads idle workers and starts a fresh one for the next suggestion', async () => {
  vi.useFakeTimers()
  const open = vi.fn<() => Worker>(() =>
    worker(`parentPort.postMessage({id:message.id,mode:'terminal',reason:'GLiClass suggestion'})`),
  )
  const router = new WorkspaceRouter(open)
  try {
    expect((await router.route('pnpm test')).mode).toBe('terminal')
    await vi.advanceTimersByTimeAsync(60_001)
    expect((await router.route('git diff')).mode).toBe('terminal')
    expect(open).toHaveBeenCalledTimes(2)
  } finally {
    await router.dispose()
  }
})
it('validates suggested picker IDs against the catalog for their original job', async () => {
  const router = new WorkspaceRouter(() =>
    worker(
      `parentPort.postMessage({id:message.id,mode:'thread',reason:'GLiClass suggestion',selections:{model:message.text === 'valid'?'opus':'invented'}})`,
    ),
  )
  try {
    const context = {
      catalogs: {
        model: [
          { id: 'keep', label: 'Keep current model' },
          { id: 'opus', label: 'Opus' },
        ],
      },
    }
    const [valid, invalid] = await Promise.all([
      router.route('valid', context),
      router.route('invalid', context),
    ])
    expect(valid.selections?.model).toBe('opus')
    expect(invalid.selections).toBeUndefined()
    expect(invalid.reason).toContain('unavailable selection')
  } finally {
    await router.dispose()
  }
})
