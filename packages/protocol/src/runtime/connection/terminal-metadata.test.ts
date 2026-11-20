import { expect, it } from 'vite-plus/test'
import { decode, decodeResult } from '../../shared/schema.js'
import {
  snapshotSchema,
  terminalSchema,
  updateTerminalSchema,
  terminalActivitySchema,
} from './runtime.js'

it('keeps terminals without reported activity compatible and validates explicit reports', () => {
  expect(
    decodeResult(terminalSchema, {
      id: 't',
      taskId: 'studio:terminals',
      title: 'Terminal 1',
      exited: false,
    }).success,
  ).toBe(true)
  for (const state of ['idle', 'working', 'done', 'blocked', 'error'])
    expect(decodeResult(terminalActivitySchema, { state }).success).toBe(true)
  const tagged = { state: 'working', turnId: 'Review/4+2' }
  expect(decode(terminalActivitySchema, tagged)).toEqual(tagged)
  for (const value of [
    { state: 'done', turnId: 'x'.repeat(129) },
    { state: 'done', turnId: 'review 42' },
    { state: 'running' },
    { state: 'waiting' },
    { state: 'working', progress: 101 },
    { state: 'working', progress: 1.5 },
    { state: 'blocked', app: 'not a name' },
    { state: 'blocked', message: 'one\ntwo' },
    { state: 'idle', title: '\u202eSpoof' },
  ])
    expect(decodeResult(terminalActivitySchema, value).success).toBe(false)
})

it('allows renaming and restoring automatic names, rejecting unsafe and oversized titles', () => {
  for (const title of ['Build', '项目 🙂', null])
    expect(decodeResult(updateTerminalSchema, { id: 't', title }).success).toBe(true)
  for (const title of ['', '   ', '\x1b]2;spoof', 'a\nb', '\u202eSpoof', '\ud800', 'x'.repeat(257)])
    expect(decodeResult(updateTerminalSchema, { id: 't', title }).success).toBe(false)
})

it('recognizes live terminal recovery only when the runtime advertises it', async () => {
  const { terminalRecoveryDescription } = await import('./terminal-status.js')
  const input = {
    revision: 1,
    owner: false,
    approvals: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    workspace: {
      version: 1,
      runtimeAddress: '',
      automations: [],
      repositories: [],
      agents: [],
      tasks: [],
    },
  }
  const old = decode(snapshotSchema, { ...input, terminalRecoverySupported: true })
  expect(old.terminalTurnIdsSupported).toBeUndefined()
  expect(
    decode(snapshotSchema, { ...old, terminalTurnIdsSupported: true }).terminalTurnIdsSupported,
  ).toBe(true)
  const live = decode(snapshotSchema, { ...old, terminalLiveRecoverySupported: true })
  expect(live.terminalLiveRecoverySupported).toBe(true)
  expect(old.terminalLiveRecoverySupported).toBeUndefined()
  expect(terminalRecoveryDescription(decode(snapshotSchema, input))).toContain(
    'Update this computer',
  )
  expect(terminalRecoveryDescription(old)).toContain('Other running commands stop')
  expect(terminalRecoveryDescription(live)).toContain('running commands alive')
})
