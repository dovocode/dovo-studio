import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import { terminalSchema, updateTerminalSchema, terminalActivitySchema } from './runtime.js'

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
  for (const value of [
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
