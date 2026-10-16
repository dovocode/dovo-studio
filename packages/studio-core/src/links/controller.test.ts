import { expect, it, vi } from 'vite-plus/test'
import { LinkController, linkActions, type LinkRequest } from './controller'

function fixture() {
  const controller = new LinkController()
  const run = vi.fn<() => unknown>(() => undefined)
  const onError = vi.fn<(error: unknown) => void>()
  const signal = new AbortController()
  const request: LinkRequest = {
    url: 'http://runtime.lan/docs#example',
    signal: signal.signal,
    onError,
    actions: [{ id: 'browser', label: 'Browser', kind: 'browser', run }],
  }
  return { controller, run, request, signal, onError }
}

it('owns one chooser and dispatches a repeated selection only once after native dismissal', async () => {
  const { controller, request, run } = fixture()
  const dismiss = vi.fn<() => void>()
  controller.open(request)
  controller.open({ ...request, url: 'https://other.example' })
  expect(controller.getSnapshot()?.request).toBe(request)
  controller.select(request, 'browser', dismiss)
  controller.select(request, 'browser', dismiss)
  expect(dismiss).toHaveBeenCalledOnce()
  expect(run).not.toHaveBeenCalled()
  controller.dismissed(request)
  controller.dismissed(request)
  controller.select(request, 'browser', dismiss)
  expect(dismiss).toHaveBeenCalledOnce()
  expect(controller.getSnapshot()).toBeNull()
  expect(run).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(controller.getSnapshot()).toBeNull())
})

it('keeps an aborted native presenter alive until dismissal and ignores stale callbacks', () => {
  const { controller, request, run, signal } = fixture()
  controller.open(request)
  controller.select(request, 'browser', () => {})
  signal.abort()
  expect(controller.getSnapshot()).toMatchObject({ busy: true, closing: true })
  const next = { ...request, signal: undefined }
  controller.open(next)
  expect(controller.getSnapshot()?.request).toBe(request)
  controller.dismissed(request)
  expect(run).not.toHaveBeenCalled()
  controller.open(next)
  controller.dismissed(request)
  expect(controller.getSnapshot()?.request).toBe(next)
})

it('cancels without side effects and permits a new request', () => {
  const { controller, request, run } = fixture()
  controller.open(request)
  controller.dismissed(request)
  expect(controller.getSnapshot()).toBeNull()
  expect(run).not.toHaveBeenCalled()
  const next = { ...request }
  controller.open(next)
  expect(controller.getSnapshot()?.request).toBe(next)
})

it('retains ownership until an asynchronous destination completes, even after abort', async () => {
  const { controller, request, run, signal } = fixture()
  let finish = () => {}
  run.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  controller.open(request)
  controller.select(request, 'browser', () => controller.dismissed(request))
  signal.abort()
  const next = { ...request, signal: undefined }
  controller.open(next)
  expect(controller.getSnapshot()).toBeNull()
  finish()
  await Promise.resolve()
  controller.open(next)
  expect(controller.getSnapshot()?.request).toBe(next)
})

it('shows mutation failures in place, permits retry, and closes only on success', async () => {
  const { controller, request, run } = fixture()
  request.actions[0].keepOpen = true
  run.mockRejectedValueOnce(new Error('Permission denied')).mockResolvedValueOnce(undefined)
  const dismiss = vi.fn<() => void>(() => controller.dismissed(request))
  controller.open(request)
  controller.select(request, 'browser', dismiss)
  await vi.waitFor(() => expect(controller.getSnapshot()?.error).toBe('Permission denied'))
  expect(dismiss).not.toHaveBeenCalled()
  controller.select(request, 'browser', dismiss)
  await vi.waitFor(() => expect(dismiss).toHaveBeenCalledOnce())
  expect(run).toHaveBeenCalledTimes(2)
  expect(controller.getSnapshot()).toBeNull()
})

it('does not navigate after a mutation owner aborts during execution', async () => {
  const { controller, request, run, signal } = fixture()
  request.actions[0].keepOpen = true
  let finish = () => {}
  run.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const dismiss = vi.fn<() => void>()
  controller.open(request)
  controller.select(request, 'browser', dismiss)
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  signal.abort()
  controller.dismissed(request)
  finish()
  await Promise.resolve()
  await Promise.resolve()
  expect(dismiss).not.toHaveBeenCalled()
  expect(controller.getSnapshot()).toBeNull()
})

it('reports destination failures and releases the controller for retry', async () => {
  const { controller, request, run, onError } = fixture()
  run.mockRejectedValueOnce(new Error('Browser unavailable'))
  controller.open(request)
  controller.select(request, 'browser', () => controller.dismissed(request))
  await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
  controller.open({ ...request })
  expect(controller.getSnapshot()).not.toBeNull()
})

it('rejects unsafe URLs and ignores disabled or already aborted requests', () => {
  const { controller, request, signal, run } = fixture()
  expect(() => controller.open({ ...request, url: 'javascript:alert(1)' })).toThrow(
    'Use an HTTP or HTTPS address.',
  )
  request.actions[0].disabled = true
  controller.open(request)
  controller.select(request, 'browser', () => controller.dismissed(request))
  expect(run).not.toHaveBeenCalled()
  controller.dispose()
  signal.abort()
  controller.open(request)
  expect(controller.getSnapshot()).toBeNull()
})

it('uses the same direct actions for menus and choosers without losing HTTP or fragments', () => {
  const external = vi.fn<(url: string) => unknown>()
  const details = vi.fn<() => unknown>()
  const url = 'http://runtime.lan/docs?q=one#section'
  const actions = linkActions(url, [], { details, external })
  expect(actions.map((action) => action.id)).toEqual(['external'])
  actions[0].run()
  expect(external).toHaveBeenCalledWith(url)
  expect(details).not.toHaveBeenCalled()
})
