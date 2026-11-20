import { expect, it } from 'vite-plus/test'
import type { TerminalInfo } from '@dovo/protocol'
import { terminalStatus } from './terminal-status'

const shell: TerminalInfo = {
  id: 'shell',
  taskId: 'studio:terminals',
  title: 'Shell',
  exited: false,
}

it('does not infer work without foreground inspection or an explicit activity report', () => {
  expect(terminalStatus(shell, true)).toMatchObject({ label: 'Live session', section: 'active' })
  expect(terminalStatus({ ...shell, activity: { state: 'idle' } }, true)).toMatchObject({
    label: 'Idle',
    section: 'active',
  })
})

it('shows ordinary foreground commands as running and the shell prompt as idle', () => {
  const running = { ...shell, foregroundProcess: { name: 'sleep', idle: false } }
  expect(terminalStatus(running, true)).toMatchObject({
    label: 'Running',
    section: 'working',
    detail: 'sleep',
  })
  expect(
    terminalStatus({ ...shell, foregroundProcess: { name: 'zsh', idle: true } }, true),
  ).toMatchObject({ label: 'Idle', section: 'active' })
  expect(
    terminalStatus({ ...running, activity: { state: 'blocked', kind: 'permission' } }, true),
  ).toMatchObject({ label: 'Needs input', section: 'needs-input' })
  expect(terminalStatus({ ...running, activity: { state: 'done' } }, true)).toMatchObject({
    label: 'Done',
    section: 'active',
  })
  expect(terminalStatus({ ...running, exited: true, exitCode: 0 }, true).label).toBe('Exited 0')
  expect(terminalStatus(running, false).label).toBe('Offline')
  expect(
    terminalStatus({ ...shell, integrationError: 'Could not install hooks' }, true).detail,
  ).toBe('Could not install hooks')
})

it('uses explicit activity reports without changing the session lifecycle', () => {
  expect(
    terminalStatus({ ...shell, activity: { state: 'working', progress: 0 } }, true),
  ).toMatchObject({
    label: 'Working 0%',
    section: 'working',
  })
  expect(
    terminalStatus({ ...shell, activity: { state: 'blocked', message: 'Approve deploy?' } }, true),
  ).toMatchObject({ label: 'Needs input', section: 'needs-input', detail: 'Approve deploy?' })
  expect(terminalStatus({ ...shell, activity: { state: 'done' } }, true).section).toBe('active')
  expect(terminalStatus({ ...shell, activity: { state: 'error' } }, true).section).toBe(
    'needs-input',
  )
  expect(shell.exited).toBe(false)
  expect(shell.settledAt).toBeUndefined()
})

it('prioritizes offline and exited state over stale activity', () => {
  const working: TerminalInfo = { ...shell, activity: { state: 'working' } }
  expect(terminalStatus(working, false)).toMatchObject({ label: 'Offline', section: 'active' })
  expect(terminalStatus({ ...working, exited: true, exitCode: 1 }, true)).toMatchObject({
    label: 'Exited 1',
    tone: 'error',
    section: 'active',
  })
})

it('identifies sleeping sessions and recovery errors without showing stale working status', () => {
  const sleeping: TerminalInfo = { ...shell, dormant: true, activity: { state: 'working' } }
  expect(terminalStatus(sleeping, true)).toMatchObject({ label: 'Sleeping', section: 'active' })
  expect(terminalStatus({ ...sleeping, recoveryError: 'Folder missing' }, true)).toMatchObject({
    label: 'Recovery needs attention',
    detail: 'Folder missing',
    tone: 'warning',
  })
  expect(terminalStatus(sleeping, false).label).toBe('Offline')
})

it('shows a blocked child separately while preserving the parent badge and shared seen turn', () => {
  const session: TerminalInfo = {
    ...shell,
    turn: 4,
    seenTurn: 4,
    activity: { state: 'working', progress: 50 },
    childActivities: [{ id: 'test/check', activity: { state: 'blocked' } }],
  }
  expect(terminalStatus(session, true)).toMatchObject({
    label: 'Working 50%',
    tone: 'working',
    section: 'needs-input',
    childAttention: 'test/check needs input',
  })
  expect(terminalStatus({ ...session, activity: { state: 'done' } }, true)).toMatchObject({
    label: 'Idle',
    section: 'needs-input',
  })
  expect(
    terminalStatus({ ...session, activity: { state: 'idle' }, seenTurn: 3 }, true),
  ).toMatchObject({ label: 'Done', section: 'needs-input' })
  expect(terminalStatus({ ...session, activity: { state: 'blocked' } }, true).label).toBe(
    'Needs input',
  )
  expect(terminalStatus(session, false).childAttention).toBeUndefined()
  expect(terminalStatus({ ...session, exited: true }, true).childAttention).toBeUndefined()
})

it('names each blocked child and explains its reported reason', () => {
  const session: TerminalInfo = {
    ...shell,
    activity: { state: 'idle' },
    childActivities: [
      {
        id: 'one',
        activity: {
          state: 'blocked',
          title: 'Builder',
          kind: 'permission',
          message: 'Write files?',
        },
      },
      { id: 'two', activity: { state: 'blocked', kind: 'question', message: 'Which branch?' } },
      { id: 'three', activity: { state: 'blocked', kind: 'auth' } },
      { id: 'four', activity: { state: 'done' } },
    ],
  }
  expect(terminalStatus(session, true)).toMatchObject({
    label: 'Idle',
    section: 'needs-input',
    childAttention: '3 child agents need input',
    childDetails: [
      'Builder (one) needs permission · Write files?',
      'two has a question · Which branch?',
      'three needs authentication',
    ],
  })
})

it('only direct child terminals from this computer can move their parent into Needs input', () => {
  const parent = { ...shell, taskId: 'studio:terminals', activity: { state: 'working' as const } }
  const child = {
    ...parent,
    id: 'child',
    title: 'Checks',
    parentTerminalId: parent.id,
    activity: { state: 'blocked' as const, kind: 'permission' as const },
  }
  expect(terminalStatus(parent, true, [child])).toMatchObject({
    label: 'Working',
    section: 'needs-input',
    childAttention: 'Checks needs permission',
  })
  for (const unrelated of [
    { ...child, parentTerminalId: 'another' },
    { ...child, taskId: 'ordinary-thread' },
    { ...child, dormant: true },
    { ...child, exited: true },
  ])
    expect(terminalStatus(parent, true, [unrelated]).section).toBe('working')
  expect(terminalStatus(parent, false, [child]).label).toBe('Offline')
})
