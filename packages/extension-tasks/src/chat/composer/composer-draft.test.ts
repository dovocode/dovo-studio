import { afterEach, expect, test, vi } from 'vite-plus/test'
import { createComposerDraft } from './composer-draft'

afterEach(() => vi.useRealTimers())

test('acceptance cancels the old debounce and cleanup cannot restore submitted text', () => {
  vi.useFakeTimers()
  const write = vi.fn<(text: string) => void>()
  const draft = createComposerDraft('', write)
  draft.update('old message')
  draft.accept('old message')
  vi.runAllTimers()
  draft.flush()
  expect(write.mock.calls).toEqual([['']])
  expect(draft.receive('old message')).toBe('')
})

test('a late snapshot cannot overwrite unsaved typing', () => {
  vi.useFakeTimers()
  const write = vi.fn<(text: string) => void>()
  const draft = createComposerDraft('saved', write)
  draft.update('new typing')
  expect(draft.receive('external')).toBe('new typing')
  draft.flush()
  expect(write).toHaveBeenLastCalledWith('new typing')
})

test('accepting a send preserves text inserted while the request was pending', () => {
  vi.useFakeTimers()
  const write = vi.fn<(text: string) => void>()
  const draft = createComposerDraft('sent', write)
  draft.update('next message')
  expect(draft.accept('sent')).toBe('next message')
  expect(write).toHaveBeenLastCalledWith('next message')
  expect(draft.receive('sent')).toBe('next message')
})

test('unmount flushes final typing exactly once', () => {
  vi.useFakeTimers()
  const write = vi.fn<(text: string) => void>()
  const draft = createComposerDraft('', write)
  draft.update('last characters')
  draft.flush()
  vi.runAllTimers()
  expect(write.mock.calls).toEqual([['last characters']])
})

test('failed persistence remains pending for a later flush', () => {
  vi.useFakeTimers()
  const error = vi.fn<(cause: unknown) => void>()
  const write = vi.fn<(text: string) => void>().mockImplementationOnce(() => {
    throw new Error('connection changed')
  })
  const draft = createComposerDraft('', write, error)
  draft.update('keep me')
  vi.runAllTimers()
  expect(error).toHaveBeenCalledOnce()
  draft.flush()
  expect(write).toHaveBeenLastCalledWith('keep me')
})

test('failed clear persistence still consumes text and cleanup retries the empty draft', () => {
  const write = vi.fn<(text: string) => void>().mockImplementationOnce(() => {
    throw new Error('connection changed')
  })
  const draft = createComposerDraft('sent', write)
  expect(() => draft.accept('sent')).toThrow('connection changed')
  expect(draft.text).toBe('')
  expect(draft.receive('sent')).toBe('')
  draft.flush()
  expect(write).toHaveBeenLastCalledWith('')
})
