import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { decode, questionPromptSchema, runtimeProfile } from '@dovo/protocol'
const native = vi.hoisted(() => ({
  configure: vi.fn<(json: string) => Promise<void>>(),
  getDraft: vi.fn<(runtimeId: string, id: string) => Promise<unknown>>(),
  clearDraft: vi.fn<(runtimeId: string, id: string) => Promise<void>>(),
}))
vi.mock('expo', () => ({ requireOptionalNativeModule: () => native }))
import {
  configureNotificationAnswers,
  notificationAnswerDraft,
  clearNotificationAnswerDraft,
  isNativeAnswerAction,
} from './answers'
beforeEach(() => vi.resetAllMocks())
const request = {
  id: 'question',
  taskId: 'thread',
  createdAt: '',
  prompt: decode(questionPromptSchema, {
    title: 'Which branch?',
    questions: [
      {
        id: 'branch',
        header: 'Branch',
        question: 'Which branch?',
        options: [{ label: 'Main', value: 'main' }],
      },
    ],
  }),
}
it('sends only current paired origins and tokens to the native device cache, preserving HTTP', async () => {
  const profile = runtimeProfile({
    address: 'http://100.100.1.2:4343',
    token: 'paired-device-token-at-least-20-characters',
  })
  await expect(configureNotificationAnswers([profile])).resolves.toBe(true)
  expect(JSON.parse(native.configure.mock.calls[0][0])).toEqual({
    [profile.id]: {
      address: 'http://100.100.1.2:4343',
      token: 'paired-device-token-at-least-20-characters',
    },
  })
  await configureNotificationAnswers([])
  expect(native.configure).toHaveBeenLastCalledWith('{}')
})
it('restores unconfirmed text and choice drafts for the exact runtime and question', async () => {
  native.getDraft.mockResolvedValue({ fieldId: 'branch', value: 'main' })
  expect(await notificationAnswerDraft('host', request)).toEqual({
    branch: { selected: ['main'], text: '' },
  })
  expect(native.getDraft).toHaveBeenCalledWith('host', 'question')
  native.getDraft.mockResolvedValue({ fieldId: 'branch', value: 'custom branch' })
  expect(await notificationAnswerDraft('host', request)).toEqual({
    branch: { selected: [], text: 'custom branch' },
  })
  await clearNotificationAnswerDraft('host', request.id)
  expect(native.clearDraft).toHaveBeenCalledWith('host', 'question')
})
it('does not restore drafts into secret, unknown or incompatible fields', async () => {
  native.getDraft.mockResolvedValue({ fieldId: 'unknown', value: 'main' })
  expect(await notificationAnswerDraft('host', request)).toBeUndefined()
  native.getDraft.mockResolvedValue({ fieldId: 'branch', value: 'main' })
  expect(
    await notificationAnswerDraft('host', {
      ...request,
      prompt: { ...request.prompt, questions: [{ ...request.prompt.questions[0], secret: true }] },
    }),
  ).toBeUndefined()
  native.getDraft.mockResolvedValue({ fieldId: 'branch', value: 'removed' })
  expect(
    await notificationAnswerDraft('host', {
      ...request,
      prompt: { ...request.prompt, questions: [{ ...request.prompt.questions[0], custom: false }] },
    }),
  ).toBeUndefined()
  native.getDraft.mockRejectedValue(new Error('Device is locked'))
  await expect(notificationAnswerDraft('host', request)).rejects.toThrow('Device is locked')
})
it('keeps native reply actions out of the foreground-open handler', () => {
  for (const action of ['dovo-reply', 'dovo-choice-0', 'dovo-choice-1', 'dovo-choice-2'])
    expect(isNativeAnswerAction(action)).toBe(true)
  for (const action of [
    'answer-question',
    'expo.modules.notifications.actions.DEFAULT',
    'dovo-choice-3',
  ])
    expect(isNativeAnswerAction(action)).toBe(false)
})
