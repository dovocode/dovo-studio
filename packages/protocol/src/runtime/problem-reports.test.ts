import { expect, it } from 'vite-plus/test'
import { decode, decodeResult } from '../shared/schema'
import { snapshotSchema } from './connection/runtime'
import { recentClientErrors, recordClientError } from '../shared/client-diagnostics'
import {
  MAX_PROBLEM_REPORT_CLIENT_ERRORS,
  defaultProblemReportInclude,
  problemReportRequest,
  problemReportRequestSchema,
  problemReportTargets,
  problemReportTitle,
} from './problem-reports'
import type { RuntimeOverview } from './connection/runtime-fleet'

const client = { surface: 'desktop' as const, appVersion: '1.2.3' }
const errors = Array.from({ length: 25 }, (_, index) => ({
  at: `2026-11-16T10:00:${String(index).padStart(2, '0')}.000Z`,
  message: `Error ${index}`,
}))

it('includes versions by default but leaves optional diagnostic records off', () => {
  expect(defaultProblemReportInclude).toEqual({
    versions: true,
    diagnostics: false,
    clientErrors: false,
    clientTimeline: false,
  })
})

it('builds a trimmed request and sends client errors only when included', () => {
  const request = problemReportRequest(
    {
      description: '  Threads stop loading \n',
      expected: '  ',
      include: { ...defaultProblemReportInclude, clientErrors: true },
    },
    client,
    errors,
  )
  expect(request.description).toBe('Threads stop loading')
  expect(request).not.toHaveProperty('expected')
  expect(request.include).toEqual({
    versions: true,
    diagnostics: false,
    clientErrors: true,
    clientTimeline: false,
  })
  expect(request.clientErrors).toHaveLength(MAX_PROBLEM_REPORT_CLIENT_ERRORS)
  expect(request.clientErrors.at(-1)?.message).toBe('Error 24')
  expect(decodeResult(problemReportRequestSchema, request).success).toBe(true)

  const without = problemReportRequest(
    {
      description: 'Threads stop loading',
      expected: 'They load',
      include: { ...defaultProblemReportInclude, clientErrors: false },
    },
    client,
    errors,
  )
  expect(without.clientErrors).toEqual([])
  expect(without.expected).toBe('They load')
  expect(decodeResult(problemReportRequestSchema, { ...without, description: '   ' }).success).toBe(
    false,
  )
})

it('titles the thread from the first line and keeps it within the title limit', () => {
  expect(problemReportTitle('Sync fails\nmore detail')).toBe('Problem: Sync fails')
  expect(problemReportTitle('x'.repeat(200))).toHaveLength(80)
})

it('offers only connected computers that support reports and have projectless threads', () => {
  const overview = (id: string, supported: boolean, connected = true): RuntimeOverview => ({
    profile: {
      id,
      name: id,
      connection: { address: 'http://10.0.0.2:4321', token: 't'.repeat(20) },
    },
    snapshot: decode(snapshotSchema, {
      ...(supported ? { problemReportsSupported: true } : {}),
      revision: 1,
      workspace: {
        version: 1,
        agents: [],
        repositories: [
          {
            id: 'dovo:scratch',
            name: 'No Project',
            path: '/tmp/s',
            branch: 'main',
            kind: 'scratch',
          },
        ],
        tasks: [],
        automations: [],
        runtimeAddress: 'http://10.0.0.2:4321',
      },
      approvals: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
      owner: true,
    }),
    connected,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
  })
  const targets = problemReportTargets([
    overview('new', true),
    overview('old', false),
    overview('offline', true, false),
  ])
  expect(targets.map((target) => [target.profile.id, target.supported, target.available])).toEqual([
    ['new', true, true],
    ['old', false, false],
    ['offline', true, false],
  ])
})

it('keeps a bounded, redacted log of recent client errors and folds repeats', () => {
  for (let index = 0; index < 30; index++) recordClientError(new Error(`failure ${index}`), 'view')
  recordClientError(new TypeError('token=abc123secret leaked'), 'app')
  recordClientError(new TypeError('token=abc123secret leaked'), 'app')
  const recent = recentClientErrors()
  expect(recent).toHaveLength(20)
  expect(recent.at(-1)).toMatchObject({
    source: 'app',
    message: 'TypeError: token=[redacted] leaked',
  })
  expect(recent.at(-2)?.message).toBe('failure 29')
})
