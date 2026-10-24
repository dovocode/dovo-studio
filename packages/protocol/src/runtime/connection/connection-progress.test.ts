import { expect, it } from 'vite-plus/test'
import { connectionProgress } from './connection-progress.js'
import { snapshotSchema } from './runtime.js'
import { decode } from '../../shared/schema.js'

const waiting = { connected: false, unauthorized: false, error: null, snapshot: null }
it('reports initial discovery, denied access and recovery without claiming readiness', () => {
  expect(connectionProgress(waiting).map((step) => step.state)).toEqual([
    'current',
    'pending',
    'pending',
    'pending',
  ])
  expect(connectionProgress({ ...waiting, unauthorized: true, error: 'Expired' })[1].state).toBe(
    'failed',
  )
  expect(
    connectionProgress({ ...waiting, unauthorized: true, error: 'Expired' }, true)[1].state,
  ).toBe('current')
  expect(connectionProgress({ ...waiting, error: 'Unreachable' })[0].state).toBe('failed')
  expect(
    connectionProgress({ ...waiting, connected: true }).every((step) => step.state === 'done'),
  ).toBe(true)
})

it('does not treat a saved snapshot as current access', () => {
  const snapshot = decode(snapshotSchema, {
    revision: 1,
    workspace: {
      version: 1,
      runtimeAddress: '',
      agents: [],
      repositories: [],
      tasks: [],
      automations: [],
    },
    approvals: [],
    questions: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    owner: false,
  })
  const steps = connectionProgress({ ...waiting, snapshot })
  expect(steps[1].state).toBe('pending')
  expect(steps[2].state).toBe('current')
  expect(steps[3].state).toBe('pending')
})
