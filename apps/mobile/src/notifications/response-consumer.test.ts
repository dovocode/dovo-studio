import { expect, it, vi } from 'vite-plus/test'

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }))
import { createNotificationResponseConsumer } from './response-consumer'

type ConsumerOptions = Parameters<typeof createNotificationResponseConsumer>[0]

function response(
  id: string,
  actionIdentifier = 'open',
  data: unknown = { runtimeId: 'host', taskId: id },
) {
  return { actionIdentifier, notification: { request: { identifier: id, content: { data } } } }
}

it('retains cold-start taps until navigation and runtime are ready, including after relaunch', async () => {
  const tap = response('thread')
  let ready = false
  const open = vi.fn<ConsumerOptions['open']>()
  const clear = vi.fn<ConsumerOptions['clear']>()
  const options = {
    ready: () => ready,
    open,
    last: () => tap,
    clear,
    onError: vi.fn<ConsumerOptions['onError']>(),
  }
  const first = createNotificationResponseConsumer(options)
  first.handle(tap)
  first.handle(tap)
  expect(open).not.toHaveBeenCalled()
  expect(clear).not.toHaveBeenCalled()
  first.dispose()
  const relaunched = createNotificationResponseConsumer(options)
  relaunched.handle(tap)
  ready = true
  relaunched.flush()
  relaunched.handle(tap)
  await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())
  expect(open).toHaveBeenCalledOnce()
  expect(open).toHaveBeenCalledWith({ runtimeId: 'host', taskId: 'thread' })
})

it('does not clear a newer tap when handling older or native responses', async () => {
  const first = response('one')
  const next = response('two')
  let last = next
  const open = vi.fn<ConsumerOptions['open']>()
  const clear = vi.fn<ConsumerOptions['clear']>()
  const consumer = createNotificationResponseConsumer({
    ready: () => true,
    open,
    last: () => last,
    clear,
    onError: vi.fn<ConsumerOptions['onError']>(),
  })
  consumer.handle(first)
  consumer.handle(response('native', 'dovo-reply'))
  consumer.handle(response('invalid', 'open', {}))
  consumer.handle(next)
  await vi.waitFor(() => expect(clear).toHaveBeenCalledOnce())
  expect(open.mock.calls.map(([target]) => target.taskId)).toEqual(['one', 'two'])
  last = response('native', 'dovo-choice-0')
  consumer.handle(last)
  await vi.waitFor(() => expect(clear).toHaveBeenCalledTimes(2))
  expect(open).toHaveBeenCalledTimes(2)
})

it('keeps a failed navigation pending and retries on a duplicate tap', () => {
  const tap = response('thread')
  const open = vi.fn<ConsumerOptions['open']>().mockImplementationOnce(() => {
    throw new Error('not ready')
  })
  const clear = vi.fn<ConsumerOptions['clear']>()
  const onError = vi.fn<ConsumerOptions['onError']>()
  const consumer = createNotificationResponseConsumer({
    ready: () => true,
    open,
    last: () => tap,
    clear,
    onError,
  })
  expect(() => consumer.handle(tap)).not.toThrow()
  expect(onError).toHaveBeenCalledWith('open')
  expect(clear).not.toHaveBeenCalled()
  consumer.handle(tap)
  expect(open).toHaveBeenCalledTimes(2)
  expect(clear).toHaveBeenCalledOnce()
  consumer.handle(tap)
  expect(open).toHaveBeenCalledTimes(2)
})
