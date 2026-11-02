import { expect, it, vi } from 'vite-plus/test'
import type { AgentRun } from '../../execution/types.js'
import { claudeQuestions } from './claude-questions.js'

const input = {
  questions: ['First?', 'Second?'].map((question) => ({
    question,
    header: question,
    options: [{ label: 'Yes', description: 'Proceed' }],
  })),
}
function run(ask: AgentRun['ask']): AgentRun {
  return {
    agent: {
      id: 'claude',
      name: 'Claude',
      provider: 'claude',
      model: '',
      endpoint: '',
      instructions: '',
      permission: 'ask',
    },
    cwd: '/tmp',
    prompt: '',
    signal: new AbortController().signal,
    onSession() {},
    onText() {},
    onActivity() {},
    approve: async () => 'deny',
    ask,
  }
}
it('preserves per-question skipped and replied-in-chat outcomes only for capable CLIs', async () => {
  const ask = vi.fn<AgentRun['ask']>(async (_prompt, _signal, _validate, onUnanswered) => {
    onUnanswered?.({ '1': 'replied_in_chat' })
    return { '0': ['Yes'], '1': [] }
  })
  const result = await claudeQuestions(input, run(ask), new AbortController().signal, true)
  expect(result).toMatchObject({
    behavior: 'allow',
    updatedInput: {
      answers: { 'First?': 'Yes', 'Second?': '' },
      annotations: { 'Second?': { unanswered: 'replied_in_chat' } },
    },
  })
  expect(ask.mock.calls[0][0]).toMatchObject({
    unanswered: true,
    questions: [{ required: false }, { required: false }],
  })
  const skipped = await claudeQuestions(
    input,
    run(async () => ({})),
    new AbortController().signal,
    true,
  )
  expect(skipped).toMatchObject({
    updatedInput: {
      annotations: { 'First?': { unanswered: 'skipped' }, 'Second?': { unanswered: 'skipped' } },
    },
  })
  const legacy = await claudeQuestions(input, run(ask), new AbortController().signal)
  expect(legacy).toMatchObject({ behavior: 'allow' })
  if (legacy?.behavior !== 'allow') throw new Error('Expected legacy answers to be allowed')
  expect(legacy.updatedInput).not.toHaveProperty('annotations')
})
it('distinguishes dismissal from Stop and preserves old CLI decline behavior', async () => {
  const signal = new AbortController()
  expect(
    await claudeQuestions(
      input,
      run(async () => null),
      signal.signal,
      true,
    ),
  ).toMatchObject({
    behavior: 'allow',
    updatedInput: {
      annotations: {
        'First?': { unanswered: 'dismissed' },
        'Second?': { unanswered: 'dismissed' },
      },
    },
  })
  expect(
    await claudeQuestions(
      input,
      run(async () => null),
      signal.signal,
    ),
  ).toMatchObject({ behavior: 'deny' })
  await expect(
    claudeQuestions(
      input,
      run(async () => {
        signal.abort(new Error('Stopped'))
        return null
      }),
      signal.signal,
      true,
    ),
  ).rejects.toThrow('Stopped')
})
