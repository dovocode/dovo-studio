import { afterEach, expect, test, vi } from 'vite-plus/test'
import { parseSavedFileDiff } from './saved-file-diff-job'

class TestWorker {
  static instances: TestWorker[] = []
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  terminate = vi.fn<() => void>()
  postMessage = vi.fn<(message: unknown) => void>()
  constructor() {
    TestWorker.instances.push(this)
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  TestWorker.instances = []
})

test('cancels active work, starts queued work and ignores stale results', () => {
  vi.stubGlobal('Worker', TestWorker)
  const first = vi.fn<Parameters<typeof parseSavedFileDiff>[1]>()
  const second = vi.fn<Parameters<typeof parseSavedFileDiff>[1]>()
  const input = { path: 'a', before: 'a', after: 'b' }
  const cancel = parseSavedFileDiff(input, first)
  parseSavedFileDiff(input, second)
  expect(TestWorker.instances).toHaveLength(1)
  const stale = TestWorker.instances[0]
  cancel()
  expect(stale.terminate).toHaveBeenCalledOnce()
  expect(TestWorker.instances).toHaveLength(2)
  stale.onmessage?.({ data: { diff: {} } } as MessageEvent)
  expect(first).not.toHaveBeenCalled()
  TestWorker.instances[1].onmessage?.({ data: { diff: {} } } as MessageEvent)
  expect(second).toHaveBeenCalledOnce()
})

test('terminates timed out work and reports a fallback', () => {
  vi.useFakeTimers()
  vi.stubGlobal('Worker', TestWorker)
  const finish = vi.fn<Parameters<typeof parseSavedFileDiff>[1]>()
  parseSavedFileDiff({ path: 'a', before: 'a', after: 'b' }, finish)
  vi.advanceTimersByTime(2000)
  expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce()
  expect(finish).toHaveBeenCalledWith(null)
})
