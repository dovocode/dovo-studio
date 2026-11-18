import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import type { StudioNavigation } from '@dovo/studio-core'
import { ForkMessage } from './fork-message'
import { ForkTurn } from './fork-turn'

const fixture = vi.hoisted(() => ({
  selected: 'source',
  confirm: vi.fn<() => Promise<boolean>>(),
  navigate: vi.fn<(target: StudioNavigation) => void>(),
  request: vi.fn<(path: string) => Promise<{ id: string; messageId?: string }>>(),
  action: vi.fn<(props: { onClick: () => void }) => null>(() => null),
}))

vi.mock('@dovo/studio-core', () => ({
  useWorkspace: () => ({
    connected: true,
    request: fixture.request,
    snapshot: { messageForkSupported: true },
    workspace: { tasks: [{ id: 'source', status: 'review' }], repositories: [] },
  }),
  useConfirmation: () => fixture.confirm,
  useStudioHost: () => ({
    navigate: fixture.navigate,
    taskNavigationGuard: () => {
      const selected = fixture.selected
      return () => fixture.selected === selected
    },
  }),
}))

vi.mock('@dovo/studio-ui', () => ({ MessageAction: fixture.action }))

const forks = [
  {
    label: 'conversation fork',
    endpoint: '/api/tasks/fork-message',
    messageId: 'message',
    action: createElement(ForkMessage, {
      taskId: 'source',
      message: { id: 'message', role: 'user', text: 'Start here' },
      status: 'completed',
    }),
  },
  {
    label: 'files fork',
    endpoint: '/api/tasks/fork',
    messageId: 'reply',
    action: createElement(ForkTurn, {
      taskId: 'source',
      turn: { id: 'turn' },
      message: { id: 'reply', role: 'assistant', text: 'First answer' },
    }),
  },
]

function deferred<Value>() {
  let complete!: (value: Value) => void
  const promise = new Promise<Value>((resolve) => {
    complete = resolve
  })
  return { promise, complete }
}

beforeEach(() => {
  vi.clearAllMocks()
  fixture.selected = 'source'
  fixture.confirm.mockResolvedValue(true)
  fixture.navigate.mockImplementation(({ entityId }) => {
    if (entityId) fixture.selected = entityId
  })
})

it.each(forks)('keeps the new selection when a $label finishes late', async (fork) => {
  const reply = deferred<{ id: string }>()
  fixture.request.mockReturnValue(reply.promise)
  renderToStaticMarkup(fork.action)
  fixture.action.mock.lastCall?.[0].onClick()
  await vi.waitFor(() => expect(fixture.request.mock.calls[0]?.[0]).toBe(fork.endpoint))

  fixture.selected = 'another-thread'
  reply.complete({ id: 'saved-fork' })
  await reply.promise

  expect(fixture.selected).toBe('another-thread')
  expect(fixture.navigate).not.toHaveBeenCalled()
  expect(fixture.request).toHaveBeenCalledTimes(1)
})

it.each(forks)(
  'still saves the $label if the selection changes before confirmation',
  async (fork) => {
    const confirmation = deferred<boolean>()
    const reply = deferred<{ id: string }>()
    fixture.confirm.mockReturnValue(confirmation.promise)
    fixture.request.mockReturnValue(reply.promise)
    renderToStaticMarkup(fork.action)
    fixture.action.mock.lastCall?.[0].onClick()

    expect(fixture.confirm).toHaveBeenCalledTimes(1)
    expect(fixture.request).not.toHaveBeenCalled()
    fixture.selected = 'another-thread'
    confirmation.complete(true)
    await vi.waitFor(() => expect(fixture.request).toHaveBeenCalledTimes(1))
    reply.complete({ id: 'saved-fork' })
    await reply.promise

    expect(fixture.selected).toBe('another-thread')
    expect(fixture.navigate).not.toHaveBeenCalled()
  },
)

it.each(forks)('opens the $label at the selected message', async (fork) => {
  fixture.request.mockResolvedValue({ id: 'saved-fork', messageId: fork.messageId })
  renderToStaticMarkup(fork.action)
  fixture.action.mock.lastCall?.[0].onClick()

  await vi.waitFor(() =>
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({
      viewId: 'tasks',
      entityId: 'saved-fork',
      messageId: fork.messageId,
    }),
  )
})
