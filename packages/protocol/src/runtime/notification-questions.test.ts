import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema'
import { questionPromptSchema } from '../conversation/workflow/questions'
import {
  notificationQuestion,
  notificationQuestionBody,
  notificationQuestionCategory,
  parseNotificationQuestion,
} from './notification-questions'

const prompt = decode(questionPromptSchema, {
  title: 'Pick a branch',
  questions: [
    {
      id: 'branch',
      header: 'Branch',
      question: 'Which branch?',
      options: [
        { label: 'Main', value: 'main', description: 'Default branch' },
        { label: 'Nightly', value: 'nightly' },
      ],
    },
  ],
})
it('offers bounded single choices with complete option text and a stable category', () => {
  expect(notificationQuestion(prompt)).toEqual({
    fieldId: 'branch',
    mode: 'choice',
    choices: [
      { label: 'Main', value: 'main' },
      { label: 'Nightly', value: 'nightly' },
    ],
  })
  expect(notificationQuestionBody(prompt)).toBe(
    'Pick a branch\nBranch\nWhich branch?\n1. Main — Default branch\n2. Nightly',
  )
  expect(notificationQuestionCategory(notificationQuestion(prompt)!)).toBe('dovo-question-choice-2')
})
it('offers text replies only for a single ordinary custom-text field', () => {
  const text = { ...prompt, questions: [{ ...prompt.questions[0], options: [] }] }
  expect(notificationQuestion(text)).toEqual({ fieldId: 'branch', mode: 'text', choices: [] })
  expect(notificationQuestionCategory(notificationQuestion(text)!)).toBe('dovo-question-text')
  expect(
    notificationQuestion({ ...text, questions: [{ ...text.questions[0], custom: false }] }),
  ).toBeUndefined()
})
it('keeps secrets, multiple fields, multiple selections, numbers and long forms in the app', () => {
  const q = prompt.questions[0]
  const cases = [
    { ...prompt, questions: [q, { ...q, id: 'other' }] },
    ...[
      { secret: true },
      { multiple: true },
      { inputType: 'number' as const },
      { question: 'x'.repeat(251) },
      {
        options: Array.from({ length: 4 }, (_, i) => ({
          label: `${i}`,
          value: `${i}`,
          description: '',
        })),
      },
      { options: [{ label: 'x'.repeat(49), value: 'main', description: '' }] },
      { options: [{ label: 'Main', value: 'x'.repeat(81), description: '' }] },
      { options: [{ label: 'Main', value: 'main', description: 'x'.repeat(600) }] },
      { options: [q.options[0], q.options[0]] },
    ].map((patch) => ({ ...prompt, questions: [{ ...q, ...patch }] })),
  ]
  for (const item of cases) expect(notificationQuestion(item)).toBeUndefined()
})
it('only parses valid question-input action payloads', () => {
  const data = {
    kind: 'input',
    inputType: 'question',
    inputId: 'pending',
    question: JSON.stringify(notificationQuestion(prompt)),
  }
  expect(parseNotificationQuestion(data)).toEqual(notificationQuestion(prompt))
  for (const patch of [
    { kind: 'done' },
    { inputType: 'approval' },
    { inputId: '' },
    { question: '{' },
    { question: JSON.stringify({ fieldId: 'branch', mode: 'choice', choices: [] }) },
  ])
    expect(parseNotificationQuestion({ ...data, ...patch })).toBeUndefined()
})
