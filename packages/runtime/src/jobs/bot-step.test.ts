import { expect, it } from 'vite-plus/test'
import type { TaskTurn } from '@dovo/protocol'
import { botStepState, botStepTurn } from './bot-step'

const turn = (id: string, status: TaskTurn['status'], runId = id, error?: string): TaskTurn => ({
  id,
  runId,
  assistantId: `a-${id}`,
  agentId: 'codex',
  provider: 'codex',
  model: 'm',
  startedAt: '2026-01-01T00:00:00.000Z',
  status,
  ...(error ? { error } : {}),
})
const user = (id: string, turnId?: string) => ({
  id,
  role: 'user' as const,
  text: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...(turnId ? { turnId } : {}),
})
const idle = { status: 'review' as const }

it('binds a routine message to its own turn, not later unrelated turns', () => {
  const history = {
    messages: [user('routine', 't1'), user('person', 't2')],
    turns: [turn('t1', 'failed', 't1', 'Provider unavailable'), turn('t2', 'completed')],
  }
  expect(botStepState(idle, history, 'routine')).toMatchObject({
    kind: 'failed',
    error: 'Provider unavailable',
  })
  expect(botStepState(idle, history, 'person')).toMatchObject({ kind: 'completed' })
})

it('finishes when its own turn completes while other Bot work runs', () => {
  const history = {
    messages: [user('routine', 't1'), user('person', 't2')],
    turns: [turn('t1', 'completed'), turn('t2', 'running')],
  }
  expect(botStepState({ status: 'running', activeRunId: 't2' }, history, 'routine')).toMatchObject({
    kind: 'completed',
  })
})

it('follows a restarted run to its newest attempt', () => {
  const history = {
    messages: [user('routine', 't1')],
    turns: [turn('t1', 'failed', 'run'), turn('t1b', 'completed', 'run')],
  }
  expect(botStepTurn(history, 'routine')?.id).toBe('t1b')
  // An interrupted turn waiting for automatic recovery is not a failure yet.
  const interrupted = { messages: history.messages, turns: [turn('t1', 'failed', 'run')] }
  expect(
    botStepState(
      { status: 'failed', restartRecovery: { kind: 'turn', automatic: true } },
      interrupted,
      'routine',
    ),
  ).toEqual({ kind: 'starting', owned: false })
})

it('reports queued, missing and startup failures', () => {
  const empty = { messages: [], turns: [] }
  expect(
    botStepState(
      {
        status: 'review',
        queue: [{ ...user('routine'), text: 'x' }],
      },
      empty,
      'routine',
    ),
  ).toEqual({ kind: 'queued' })
  expect(botStepState(idle, empty, 'routine')).toEqual({ kind: 'missing' })
  const taken = { messages: [user('routine')], turns: [] }
  // Only the run that took exactly this message owns it.
  expect(botStepState({ status: 'running', activeRunId: 'r' }, taken, 'routine')).toEqual({
    kind: 'starting',
    owned: false,
  })
  expect(
    botStepState(
      {
        status: 'running',
        activeRunId: 'r',
        runAttempt: { inputMessageIds: ['routine'], promptAccepted: false },
      },
      taken,
      'routine',
    ),
  ).toEqual({ kind: 'starting', owned: true })
  expect(botStepState({ status: 'failed', error: 'No checkout' }, taken, 'routine')).toEqual({
    kind: 'failed',
    error: 'No checkout',
  })
})
