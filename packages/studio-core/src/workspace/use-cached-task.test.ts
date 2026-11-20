import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { createTask } from './actions'
import { createWorkspace } from './seed'
import type { Task, RuntimeSnapshot } from '@dovo/protocol'
import { useCachedTask } from './use-cached-task'

const read = vi.fn<() => Promise<null>>(async () => null)
let replica: Task | undefined
let snapshot: Pick<RuntimeSnapshot, 'detailTaskIds'>
vi.mock('./context', () => ({
  useWorkspace: () => ({
    snapshot,
    readCache: { read },
    runtimeRegistry: { profiles: [] },
  }),
}))
vi.mock('@dovo/protocol', async (original) => ({
  ...(await original<typeof import('@dovo/protocol')>()),
  cachedRuntimeThread: () => replica,
}))
vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => void) => effect(),
  useMemo: (factory: () => unknown) => factory(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => [initial, () => {}],
}))

beforeEach(() => {
  read.mockClear()
  snapshot = { detailTaskIds: [] }
})

function threads() {
  const task = createTask({
    title: 'Thread',
    agentId: 'agent',
    objective: '',
    repositoryId: createWorkspace().repositories[0].id,
  })
  const running: NonNullable<Task['turns']>[number] = {
    id: 'running',
    assistantId: 'reply',
    agentId: 'agent',
    provider: 'codex',
    model: 'model',
    status: 'running',
    startedAt: '2026-10-02T12:00:00Z',
  }
  return {
    cached: {
      ...task,
      turns: [running],
      messages: [{ id: 'reply', role: 'assistant' as const, text: 'Cached history' }],
    },
    summary: { ...task, turns: [{ ...running, id: 'newer', assistantId: 'new-reply' }] },
  }
}

it('keeps loading when cached history contains a running turn absent from the summary', () => {
  const { cached, summary } = threads()
  replica = cached
  const detail = useCachedTask(summary)
  expect(detail.task).toBe(summary)
  expect(detail.loaded).toBe(false)
  expect(read).toHaveBeenCalledWith('snapshot', expect.anything())
})

it('marks compatible cached detail loaded and preserves its messages', () => {
  const { cached, summary } = threads()
  replica = cached
  const detail = useCachedTask({ ...summary, turns: cached.turns })
  expect(detail.loaded).toBe(true)
  expect(detail.task?.messages).toEqual(cached.messages)
  expect(read).not.toHaveBeenCalled()
})
