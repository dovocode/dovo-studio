import { expect, it } from 'vite-plus/test'
import {
  parseCodeReviewOutput,
  verificationCommand,
  compareCodeReviews,
  approvalIsCurrent,
  type CodeReview,
} from './task-review.js'
import { recentTools } from '../automation/activity.js'
it('requires structured evidence instead of treating arbitrary prose as a clean review', () => {
  expect(() => parseCodeReviewOutput('Everything is fine')).toThrow('structured report')
  expect(() => parseCodeReviewOutput('{"findings":[]}')).toThrow('incomplete report')
  expect(
    parseCodeReviewOutput(
      '```json\n{"findings":[],"summary":"Inspected callers","notVerified":["Device restart"]}\n```',
    ).notVerified,
  ).toEqual(['Device restart'])
})
it('distinguishes command success from tool dispatch and preserves failures', () => {
  const command = (fields: object, status = 'completed') =>
    recentTools([
      {
        id: 'event',
        time: '2026-01-01',
        kind: 'tool',
        scope: 'task',
        summary: 'Command',
        payload: JSON.stringify({
          toolId: 'tool',
          turnId: 'turn',
          status,
          event: { item: { type: 'commandExecution', command: 'pnpm test', ...fields } },
        }),
      },
    ])[0]!
  expect(verificationCommand(command({ exitCode: 0 }), 'author')?.status).toBe('passed')
  expect(verificationCommand(command({ exitCode: 1 }), 'author')?.status).toBe('failed')
  expect(verificationCommand(command({}), 'author')?.status).toBe('unknown')
  expect(verificationCommand(command({}, 'running'), 'author')?.status).toBe('running')
})
it('matches repeated findings across line shifts and keeps disappeared findings distinct from verified fixes', () => {
  const finding = {
    id: 'one',
    path: 'a.ts',
    line: 1,
    title: 'Missing await',
    severity: 'high' as const,
    trigger: 'Save',
    impact: 'Lost changes',
    suggestion: 'Await',
    status: 'open' as const,
  }
  const base: CodeReview = {
    id: 'old',
    taskId: 'task',
    reviewer: 'Codex',
    model: 'model',
    createdAt: '',
    status: 'completed',
    baseline: 'tree',
    head: 'head',
    directory: '',
    files: [],
    findings: [finding],
    summary: '',
    notVerified: [],
  }
  const changes = compareCodeReviews({ ...base, findings: [{ ...finding, line: 12 }] }, base)
  expect(changes.persisting).toHaveLength(1)
  expect(changes.newFindings).toEqual([])
  expect(compareCodeReviews({ ...base, findings: [] }, base).noLongerReported).toEqual([finding])
})
it('treats approval as current only for the exact approved snapshot of a completed review', () => {
  const review: Pick<CodeReview, 'approval' | 'baseline' | 'head' | 'status'> = {
    status: 'completed',
    baseline: 'tree',
    head: 'head',
    approval: { approvedAt: '2026-01-01', baseline: 'tree', head: 'head' },
  }
  expect(approvalIsCurrent(review)).toBe(true)
  expect(approvalIsCurrent({ ...review, status: 'running' })).toBe(false)
  expect(approvalIsCurrent({ ...review, approval: undefined })).toBe(false)
  expect(approvalIsCurrent({ ...review, head: 'moved' })).toBe(false)
  expect(
    approvalIsCurrent({
      ...review,
      approval: { approvedAt: '2026-01-01', baseline: 'other', head: 'head' },
    }),
  ).toBe(false)
})
