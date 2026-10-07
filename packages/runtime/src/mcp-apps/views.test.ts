import { expect, it, vi } from 'vite-plus/test'
import { AppToolViews } from './views'
const scope = { taskId: 'thread', server: { name: 'source' } }
const read = {
  name: 'selection',
  inputSchema: { type: 'object' },
  annotations: { readOnlyHint: true },
  description: 'Selected rows',
}
const result = { content: [{ type: 'text', text: '[1,2]' }] }
function setup() {
  const views = new AppToolViews(),
    send = vi.fn<(value: unknown) => void>(),
    authorize = vi.fn<() => void>(),
    close = vi.fn<() => void>()
  const view = views.attach(
    { taskId: scope.taskId, appId: '1234', server: 'source', title: 'Table' },
    send,
    authorize,
    close,
  )
  view.receive({
    type: 'tools',
    tools: [read, { ...read, name: 'delete', annotations: { readOnlyHint: false } }],
  })
  return { views, send, authorize, close, view, name: views.list(scope)[0]!.name }
}
it('exposes only read-only tools in the owning task and server and returns current view results', async () => {
  const s = setup()
  expect(s.views.list(scope)).toHaveLength(1)
  expect(s.views.list({ ...scope, taskId: 'other' })).toEqual([])
  expect(s.views.list({ ...scope, server: { name: 'other' } })).toEqual([])
  const call = s.views.call(scope, s.name, {}, new AbortController().signal)
  const sent = s.send.mock.calls[0]![0]
  expect(sent).toMatchObject({ type: 'call', name: 'selection' })
  if (!sent || typeof sent !== 'object' || !('requestId' in sent))
    throw new Error('Missing request')
  s.view.receive({ type: 'result', requestId: sent.requestId, result })
  expect(await call).toEqual(result)
  await expect(
    s.views.call({ ...scope, taskId: 'other' }, s.name, {}, new AbortController().signal),
  ).rejects.toThrow('no longer available')
})
it('cancels calls and removes tools on view disposal or permission revocation', async () => {
  const s = setup(),
    controller = new AbortController()
  const cancelled = s.views.call(scope, s.name, {}, controller.signal)
  controller.abort()
  await expect(cancelled).rejects.toThrow('cancelled')
  expect(s.send).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'cancel' }))
  const pending = s.views.call(scope, s.name, {}, new AbortController().signal)
  s.view.close()
  await expect(pending).rejects.toThrow('disconnected')
  expect(s.views.list(scope)).toEqual([])
  expect(s.close).toHaveBeenCalledOnce()
  const revoked = setup()
  revoked.authorize.mockImplementation(() => {
    throw new Error('revoked')
  })
  expect(revoked.views.list(scope)).toEqual([])
  expect(revoked.close).toHaveBeenCalledOnce()
})
it('uses the latest connected view, rejects malformed results and applies tool updates immediately', async () => {
  const s = setup()
  const pending = s.views.call(scope, s.name, {}, new AbortController().signal)
  const sent = s.send.mock.calls[0]![0]
  if (!sent || typeof sent !== 'object' || !('requestId' in sent))
    throw new Error('Missing request')
  s.view.receive({
    type: 'result',
    requestId: sent.requestId,
    result: { content: [{ type: 'text', text: 123 }] },
  })
  await expect(pending).rejects.toThrow('Invalid MCP App tool result')
  s.view.receive({ type: 'tools', tools: [] })
  expect(s.views.list(scope)).toEqual([])
  const replacement = s.views.attach(
    { taskId: scope.taskId, appId: '1234', server: 'source', title: 'Table' },
    s.send,
    s.authorize,
    s.close,
  )
  s.view.receive({ type: 'tools', tools: [read] })
  expect(s.views.list(scope)).toEqual([])
  replacement.close()
  expect(s.views.list(scope)).toHaveLength(1)
  s.view.close()
  expect(s.views.list(scope)).toEqual([])
})
