import { expect, it } from 'vite-plus/test'
import {
  blockAccessibleNotificationInputs,
  registerAccessibleNotificationInput,
  shouldAlertForNotification,
} from './visibility'

it('only silences the exact accessible input in the active app', () => {
  const input = {
    runtimeId: 'host',
    taskId: 'thread',
    inputId: 'question',
    inputType: 'question' as const,
  }
  const data = { ...input, kind: 'input' }
  const unregister = registerAccessibleNotificationInput(input)
  expect(shouldAlertForNotification(data, true)).toBe(false)
  expect(shouldAlertForNotification(data, false)).toBe(true)
  for (const change of [
    { runtimeId: 'other' },
    { taskId: 'other' },
    { inputId: 'other' },
    { inputType: 'approval' },
    { inputId: undefined },
  ])
    expect(shouldAlertForNotification({ ...data, ...change }, true)).toBe(true)
  expect(shouldAlertForNotification({ ...data, taskId: 'dovo-notification-test' }, true)).toBe(true)
  expect(shouldAlertForNotification({ taskId: 'dovo-notification-test' }, true)).toBe(true)
  unregister()
  expect(shouldAlertForNotification(data, true)).toBe(true)
})

it('does not unregister a newer focused input', () => {
  const first = { runtimeId: 'host', taskId: 'one', inputId: 'q', inputType: 'question' as const }
  const second = { ...first, taskId: 'two' }
  const removeFirst = registerAccessibleNotificationInput(first)
  const removeSecond = registerAccessibleNotificationInput(second)
  removeFirst()
  expect(shouldAlertForNotification({ ...second, kind: 'input' }, true)).toBe(false)
  removeSecond()
})

it('tracks simultaneous visible approvals and restores alerts on blur or an obscuring sheet', () => {
  const question = {
    runtimeId: 'host',
    taskId: 'thread',
    inputId: 'question',
    inputType: 'question' as const,
  }
  const approval = { ...question, inputId: 'approval', inputType: 'approval' as const }
  const removeQuestion = registerAccessibleNotificationInput(question)
  const removeApproval = registerAccessibleNotificationInput(approval)
  const alert = (input: typeof question | typeof approval) =>
    shouldAlertForNotification({ ...input, kind: 'input' }, true)
  expect(alert(question)).toBe(false)
  expect(alert(approval)).toBe(false)
  const closeSheet = blockAccessibleNotificationInputs()
  expect(alert(question)).toBe(true)
  expect(alert(approval)).toBe(true)
  closeSheet()
  removeQuestion()
  expect(alert(question)).toBe(true)
  expect(alert(approval)).toBe(false)
  removeApproval()
  expect(alert(approval)).toBe(true)
})
