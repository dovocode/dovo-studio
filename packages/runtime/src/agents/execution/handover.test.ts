import { expect, it, vi } from 'vite-plus/test'
import type { ChatMessage } from '@dovo/protocol'
import type { AgentRun } from './types'
import { handoverHistory, handoverNotice, recoverContext } from './handover'

const compose = (messages: readonly ChatMessage[], omitted: boolean) =>
  [handoverNotice(omitted), ...messages.map((message) => `${message.role}: ${message.text}`)]
    .filter(Boolean)
    .join('\n\n')
const message = (id: string, text: string, role: ChatMessage['role'] = 'user'): ChatMessage => ({
  id,
  text,
  role,
})

it('keeps original and pending requests intact and retains a recent suffix within a byte budget', () => {
  const messages = [
    message('original', 'Original requirement'),
    message('old', 'x'.repeat(1500), 'assistant'),
    message('recent', 'Recent result', 'assistant'),
    message('pending', 'Latest request'),
  ]
  const before = structuredClone(messages)
  const replay = handoverHistory(messages, new Set(['pending']), compose, 450)
  expect(replay.messages.map((m) => m.id)).toEqual(['original', 'recent', 'pending'])
  expect(replay.prompt).toContain('Earlier conversation omitted')
  expect(Buffer.byteLength(replay.prompt)).toBeLessThanOrEqual(450)
  expect(messages).toEqual(before)
})

it('preserves all unconsumed input, attachments and review metadata', () => {
  const pending = {
    ...message('pending', 'Review this'),
    review: true,
    attachments: [{ id: 'image', name: 'image.png', mime: 'image/png', size: 1 }],
  }
  const messages = [
    message('original', 'Original'),
    message('old', 'x'.repeat(3000), 'assistant'),
    message('unconsumed', 'Also keep this'),
    pending,
  ]
  const replay = handoverHistory(messages, new Set(['unconsumed', 'pending']), compose, 500)
  expect(replay.messages).toContainEqual(pending)
  expect(replay.prompt).toContain('Also keep this')
})

it('does not truncate an oversized request or supplemental context to force a handover', () => {
  expect(() =>
    handoverHistory(
      [message('original', 'a'.repeat(2000)), message('pending', 'latest')],
      new Set(['pending']),
      compose,
      500,
    ),
  ).toThrow('exceed the handover budget')
  expect(() =>
    handoverHistory(
      [message('a', 'small')],
      new Set(),
      (messages, omitted) => compose(messages, omitted) + 'x'.repeat(2000),
      500,
    ),
  ).toThrow('exceed the handover budget')
})

it('measures unicode bytes and leaves a fitting transcript unchanged', () => {
  const messages = [
    message('a', 'Original'),
    message('b', '🦋'.repeat(300), 'assistant'),
    message('c', 'latest'),
  ]
  expect(handoverHistory(messages, new Set(), compose, 500).messages.map((m) => m.id)).toEqual([
    'a',
    'c',
  ])
  expect(handoverHistory(messages, new Set(), compose, 2000)).toEqual({
    messages,
    prompt: compose(messages, false),
  })
})

function input(): AgentRun {
  return {
    agent: {
      id: 'agent',
      name: 'Test',
      provider: 'codex',
      model: '',
      instructions: '',
      permission: 'ask',
      endpoint: '',
    },
    cwd: '/tmp',
    prompt: 'Latest request',
    sessionId: 'full-session',
    signal: new AbortController().signal,
    onText: vi.fn<AgentRun['onText']>(),
    onActivity: vi.fn<AgentRun['onActivity']>(),
    onSession: vi.fn<AgentRun['onSession']>(),
    onPromptAccepted: vi.fn<NonNullable<AgentRun['onPromptAccepted']>>(),
    approve: vi.fn<AgentRun['approve']>(async () => 'deny' as const),
    ask: vi.fn<AgentRun['ask']>(async () => null),
  }
}
it('recovers an explicit pre-accept context rejection once using the exact fresh payload', async () => {
  const run = input()
  const fresh = vi.fn<(run: AgentRun) => Promise<AgentRun>>(async (run) => ({
    ...run,
    sessionId: undefined,
    prompt: 'Bounded history + Latest request',
  }))
  const calls: AgentRun[] = []
  const adapter = recoverContext(
    {
      run: async (run) => {
        calls.push(run)
        if (run.sessionId) throw new Error('context_length_exceeded')
        run.onSession('recovered')
        run.onText('Done')
      },
    },
    fresh,
    () => false,
  )
  await adapter.run(run)
  expect(calls).toHaveLength(2)
  expect(calls[1]).toMatchObject({
    sessionId: undefined,
    prompt: 'Bounded history + Latest request',
  })
  expect(run.onSession).toHaveBeenCalledWith('recovered')
  expect(run.onText).toHaveBeenCalledWith('Done')
})

it.each([
  'accepted',
  'output',
  'permission',
  'tool',
  'steer',
  'compact',
  'fresh',
  'abort',
  'unrelated',
] as const)('never replays after %s', async (kind) => {
  const run = input()
  if (kind === 'compact') run.compact = true
  if (kind === 'fresh') run.sessionId = undefined
  if (kind === 'abort') run.signal = AbortSignal.abort()
  if (kind === 'steer')
    run.onSteer = (steer) => {
      void steer?.({ id: 'steered', prompt: 'Extra request' })
    }
  const fresh = vi.fn<(run: AgentRun) => Promise<AgentRun>>(async (run) => ({
    ...run,
    sessionId: undefined,
  }))
  const adapter = recoverContext(
    {
      run: async (run) => {
        if (kind === 'accepted') run.onPromptAccepted?.()
        if (kind === 'output') run.onText('partial')
        if (kind === 'permission') await run.approve('command', 'details')
        if (kind === 'tool') run.onEvent?.('tool.started', {})
        if (kind === 'steer') {
          run.onSteer?.(async () => {})
        }
        throw new Error(kind === 'unrelated' ? 'connection lost' : 'prompt is too long')
      },
    },
    fresh,
    () => false,
  )
  await expect(adapter.run(run)).rejects.toThrow(
    kind === 'unrelated' ? 'connection lost' : 'prompt is too long',
  )
  expect(fresh).not.toHaveBeenCalled()
})

it('preserves background work and the exhausted identity if recovery is blocked or cannot fit', async () => {
  const fresh = vi.fn<(run: AgentRun) => Promise<AgentRun>>(async () => {
    throw new Error('cannot fit')
  })
  const run = vi.fn<(run: AgentRun) => Promise<void>>(async () => {
    throw new Error('context window full')
  })
  await expect(recoverContext({ run }, fresh, () => true).run(input())).rejects.toThrow(
    'background commands are still active',
  )
  expect(fresh).not.toHaveBeenCalled()
  await expect(recoverContext({ run }, fresh, () => false).run(input())).rejects.toThrow(
    'cannot fit',
  )
  expect(run).toHaveBeenCalledTimes(2)
})

it('surfaces fresh-session rejection without a retry loop', async () => {
  const run = vi.fn<(run: AgentRun) => Promise<void>>(async () => {
    throw new Error('context_length_exceeded')
  })
  await expect(
    recoverContext(
      { run },
      async (input) => ({ ...input, sessionId: undefined }),
      () => false,
    ).run(input()),
  ).rejects.toThrow('context_length_exceeded')
  expect(run).toHaveBeenCalledTimes(2)
})
