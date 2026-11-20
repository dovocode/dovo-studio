import { expect, it } from 'vite-plus/test'
import {
  blockAccessibleNotificationInputs,
  foregroundNotificationPresentation,
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

it('silences a delegated child form shown in its parent or child when the push names the parent', () => {
  // The form on the asking child thread, on the same computer as its parent.
  const local = {
    runtimeId: 'host',
    taskId: 'child',
    ownerTaskId: 'parent',
    runtimeIdentity: 'host-identity',
    inputId: 'question',
    inputType: 'question' as const,
  }
  const parentPush = {
    kind: 'input',
    runtimeId: 'host',
    taskId: 'parent',
    inputId: 'question',
    inputType: 'question',
  }
  const remove = registerAccessibleNotificationInput(local)
  expect(shouldAlertForNotification(parentPush, true)).toBe(false)
  expect(shouldAlertForNotification({ ...parentPush, taskId: 'child' }, true)).toBe(false)
  expect(shouldAlertForNotification({ ...parentPush, taskId: 'unrelated' }, true)).toBe(true)
  // Background delivery stays as it was.
  expect(shouldAlertForNotification(parentPush, false)).toBe(true)
  remove()
  expect(shouldAlertForNotification(parentPush, true)).toBe(true)

  // The form on the child's own computer, while a parent on another computer sends the push.
  const child = { ...local, runtimeId: 'child-profile', ownerTaskId: 'child' }
  const remotePush = { ...parentPush, inputId: 'host-identity:question' }
  const remote = {
    ownerRuntimeIdentity: 'host-identity',
    id: 'question',
    kind: 'question' as const,
  }
  const removeChild = registerAccessibleNotificationInput(child)
  expect(shouldAlertForNotification(remotePush, true, remote)).toBe(false)
  expect(shouldAlertForNotification(remotePush, false, remote)).toBe(true)
  // Without the parent's snapshot, the push cannot name the child's request, so it alerts.
  expect(shouldAlertForNotification(remotePush, true)).toBe(true)
  for (const change of [
    { ownerRuntimeIdentity: 'other' },
    { id: 'other' },
    { kind: 'approval' as const },
  ])
    expect(shouldAlertForNotification(remotePush, true, { ...remote, ...change })).toBe(true)
  const closeSheet = blockAccessibleNotificationInputs()
  expect(shouldAlertForNotification(remotePush, true, remote)).toBe(true)
  closeSheet()
  removeChild()
  expect(shouldAlertForNotification(remotePush, true, remote)).toBe(true)
})

it('keeps leftover pushes out of the foreground after push or its computer is turned off', () => {
  const data = {
    runtimeId: 'host',
    taskId: 'thread',
    kind: 'input',
    inputId: 'question',
    inputType: 'question',
  }
  const present = (options: Partial<Parameters<typeof foregroundNotificationPresentation>[1]>) =>
    foregroundNotificationPresentation(data, {
      active: true,
      delivered: false,
      pushEnabled: true,
      disabledServers: [],
      ...options,
    })
  expect(present({})).toMatchObject({ shouldShowBanner: true, shouldShowList: true })
  // The in-app banner already showed it; the system list keeps it.
  expect(present({ delivered: true })).toMatchObject({
    shouldShowBanner: false,
    shouldShowList: true,
  })
  for (const options of [{ pushEnabled: false }, { disabledServers: ['host'] }])
    expect(present(options)).toEqual({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: false,
      shouldShowList: false,
    })
  expect(present({ disabledServers: ['other'] })).toMatchObject({ shouldShowBanner: true })
})
