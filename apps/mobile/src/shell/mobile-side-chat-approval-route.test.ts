import { expect, it } from 'vite-plus/test'
import { taskHref } from './task-route'

it('keeps the exact approval and runtime owner when task IDs collide', () => {
  const route = taskHref(
    'computer-b',
    'shared-child',
    undefined,
    undefined,
    'runtime-b',
    undefined,
    'approval-2',
  )
  expect(route.params).toEqual({
    runtimeId: 'computer-b',
    taskId: 'shared-child',
    runtimeIdentity: 'runtime-b',
    approvalId: 'approval-2',
  })
  expect(route.params).not.toHaveProperty('questionId')
})

it('keeps question routing and ordinary task links compatible', () => {
  expect(taskHref('computer-a', 'child', 'question-2').params).toEqual({
    runtimeId: 'computer-a',
    taskId: 'child',
    questionId: 'question-2',
  })
  expect(taskHref('computer-a', 'child').params).not.toHaveProperty('approvalId')
})
