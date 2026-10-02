import { expect, it } from 'vite-plus/test'
import { notificationTarget, notificationHref } from './target'
it('opens the exact question on its owning computer, keeping legacy task notifications compatible', () => {
  const target = notificationTarget({
    runtimeId: 'computer-b',
    taskId: 'shared-id',
    inputId: 'question-2',
    inputType: 'question',
  })
  expect(target).not.toBeNull()
  expect(target && notificationHref(target)).toEqual({
    pathname: '/(tasks)/thread/[runtimeId]/[taskId]',
    params: { runtimeId: 'computer-b', taskId: 'shared-id', questionId: 'question-2' },
  })
  expect(notificationHref({ runtimeId: 'computer-a', taskId: 'shared-id' }).params).toEqual({
    runtimeId: 'computer-a',
    taskId: 'shared-id',
  })
  expect(
    notificationHref({
      runtimeId: 'computer-a',
      taskId: 'shared-id',
      inputType: 'approval',
      inputId: 'approval',
    }).params,
  ).not.toHaveProperty('questionId')
})
it('rejects malformed or incomplete notification identities', () => {
  expect(
    notificationTarget({ runtimeId: 'host', taskId: 'task', inputType: 'question' }),
  ).toBeNull()
  for (const data of [
    undefined,
    {},
    { runtimeId: '', taskId: 'task' },
    { runtimeId: 'host', taskId: 'task', inputId: '' },
  ])
    expect(notificationTarget(data)).toBeNull()
})
