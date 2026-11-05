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
  for (const state of ['done', 'error'] as const) {
    expect(terminalStatus({ ...shell, activity: { state } }, true).section).toBe('active')
  }
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
