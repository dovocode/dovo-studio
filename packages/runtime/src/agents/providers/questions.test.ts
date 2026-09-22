import { expect, it, vi } from 'vitest'
import { questionAnswerError } from '@dovo/protocol'
import type { AgentRun } from '../types'
import { codexQuestions } from './codex-questions'
import { claudeQuestions } from './claude-questions'
import { formQuestions } from './form-questions'
function run(ask: AgentRun['ask']): AgentRun {
  return {
    agent: {
      id: 'test',
      name: 'Test',
      provider: 'codex',
      model: '',
      instructions: '',
      endpoint: '',
      permission: 'read-only',
    },
    cwd: '/tmp',
    prompt: 'Test',
    signal: new AbortController().signal,
    onSession: () => {},
    onText: () => {},
    onActivity: () => {},
    approve: async () => false,
    ask,
  }
}
it('maps Codex IDs, secrets, option restrictions and explicit decline', async () => {
  const ask = vi.fn<AgentRun['ask']>().mockResolvedValue({ '0': ['Existing'] })
  const input = {
    questions: [
      {
        id: 'plan',
        header: 'Plan',
        question: 'Which plan?',
        isOther: false,
        isSecret: true,
        options: [{ label: 'Existing', description: 'Keep patterns' }],
      },
    ],
  }
  expect(await codexQuestions(input, run(ask))).toEqual({
    answers: { plan: { answers: ['Existing'] } },
  })
  expect(ask.mock.calls[0][0].questions[0]).toMatchObject({ secret: true, custom: false })
  ask.mockResolvedValue(null)
  expect(await codexQuestions(input, run(ask))).toEqual({ answers: {} })
})
it('returns Claude selections by question text and preserves its original input', async () => {
  const input = {
    questions: [
      {
        header: 'Checks',
        question: 'Which checks?',
        multiSelect: true,
        options: [
          { label: 'Types', description: '' },
          { label: 'Tests', description: '' },
        ],
      },
    ],
  }
  const result = await claudeQuestions(
    input,
    run(async (prompt) => {
      expect(prompt.questions[0].multiple).toBe(true)
      return { '0': ['Types', 'Tests'] }
    }),
    new AbortController().signal,
  )
  expect(result).toEqual({
    behavior: 'allow',
    updatedInput: { ...input, answers: { 'Which checks?': 'Types, Tests' } },
  })
})
it('validates ACP/MCP forms using JSON Schema and returns typed values', async () => {
  const content = await formQuestions(
    'Configure checks',
    {
      type: 'object',
      required: ['count', 'enabled'],
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 5, title: null },
        enabled: { type: 'boolean' },
        target: {
          type: 'string',
          oneOf: [
            { const: 'main', title: 'Main branch' },
            { const: 'next', title: 'Next branch' },
          ],
        },
        checks: { type: 'array', items: { type: 'string', enum: ['types', 'tests'] } },
      },
    },
    run(async (prompt, _signal, validate) => {
      expect(prompt.questions[1].options.map((o) => o.label)).toEqual(['Yes', 'No'])
      expect(() => validate?.({ '0': ['7'], '1': ['false'] })).toThrow('<= 5')
      expect(
        questionAnswerError(prompt.questions, { '0': ['2'], '1': ['false'], '2': ['wrong'] }),
      ).toContain('available option')
      const answers = { '0': ['2'], '1': ['false'], '2': ['main'], '3': ['types', 'tests'] }
      validate?.(answers)
      return answers
    }),
  )
  expect(content).toEqual({ count: 2, enabled: false, target: 'main', checks: ['types', 'tests'] })
})

it.each([true, false, undefined])(
  'preserves Codex blocking=%s and accepts free text alongside choice forms',
  async (isBlocking) => {
    const ask = vi
      .fn<AgentRun['ask']>()
      .mockResolvedValue({ '0': ['My own wording'], '1': ['More context'] })
    const result = await codexQuestions(
      {
        isBlocking,
        questions: [
          {
            id: 'choice',
            header: 'Direction',
            question: 'Which direction?',
            isOther: true,
            options: [{ label: 'Recommended', description: 'Suggested direction' }],
          },
          { id: 'context', header: 'Context', question: 'Anything else?', options: null },
        ],
      },
      run(ask),
    )
    expect(ask.mock.calls[0][0].blocking).toBe(isBlocking ?? true)
    expect(ask.mock.calls[0][0].questions.every((q) => q.custom)).toBe(true)
    expect(result).toEqual({
      answers: { choice: { answers: ['My own wording'] }, context: { answers: ['More context'] } },
    })
  },
)
