import { expect, it } from 'vite-plus/test'
import type { TerminalInfo } from '@dovo/protocol'
import { terminalStatus } from './terminal-status'

const shell: TerminalInfo = {
  id: 'shell',
  taskId: 'studio:terminals',
  title: 'Shell',
  exited: false,
}

it('never treats a connected ordinary shell as working', () => {
  expect(terminalStatus(shell, true)).toMatchObject({ label: 'Live session', section: 'active' })
  expect(terminalStatus({ ...shell, activity: { state: 'idle' } }, true)).toMatchObject({
    label: 'Idle',
    section: 'active',
  })
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
