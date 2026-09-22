import { describe, expect, it } from 'vitest'
import { forgeIssueSchema, forgePipelineSchema } from './forge-work.js'
import {
  issueLabel,
  matchesWorkItem,
  pipelineActionAllowed,
  pipelineSignal,
  pipelineDuration,
} from './work-presentation.js'

describe('pipeline status and actions', () => {
  it.each([
    'queued',
    'pending',
    'requested',
    'waiting',
    'in_progress',
    'running',
    'blocked',
    'inProgress',
    'notStarted',
    'postponed',
    'PENDING',
    'IN_PROGRESS',
    'PAUSED',
    'READY',
  ])('allows cancellation but not rerun for active status %s', (status) => {
    expect(pipelineSignal(status).phase).toBe('active')
    expect(pipelineActionAllowed('cancel', status)).toBe(true)
    expect(pipelineActionAllowed('rerun', status)).toBe(false)
  })

  it.each([
    'success',
    'failure',
    'cancelled',
    'skipped',
    'completed',
    'neutral',
    'timed_out',
    'action_required',
    'stale',
    'succeeded',
    'partiallySucceeded',
    'failed',
    'canceled',
    'SUCCESSFUL',
    'FAILED',
    'ERROR',
    'SYSTEM_ERROR',
    'STOPPED',
    'EXPIRED',
    'NOT_RUN',
  ])('allows rerun but not cancellation for finished status %s', (status) => {
    expect(pipelineSignal(status).phase).toBe('finished')
    expect(pipelineActionAllowed('cancel', status)).toBe(false)
    expect(pipelineActionAllowed('rerun', status)).toBe(true)
  })

  it.each(['cancelling', 'canceling'])('waits for cancellation to finish for %s', (status) => {
    expect(pipelineSignal(status).phase).toBe('active')
    expect(pipelineActionAllowed('cancel', status)).toBe(false)
    expect(pipelineActionAllowed('rerun', status)).toBe(false)
  })

  it.each(['', 'unknown', 'none', 'all', 'newProviderState'])(
    'suppresses run actions for unknown status %s',
    (status) => {
      expect(pipelineSignal(status).phase).toBe('unknown')
      expect(pipelineActionAllowed('cancel', status)).toBe(false)
      expect(pipelineActionAllowed('rerun', status)).toBe(false)
      expect(pipelineActionAllowed('enable', status)).toBe(true)
      expect(pipelineActionAllowed('disable', status)).toBe(true)
    },
  )

  it('distinguishes success, failure, partial success and unfinished work visually', () => {
    expect(pipelineSignal('SUCCESSFUL')).toEqual({
      label: 'Passed',
      tone: 'success',
      phase: 'finished',
    })
    expect(pipelineSignal('failed').tone).toBe('danger')
    expect(pipelineSignal('partiallySucceeded').tone).toBe('warning')
    expect(pipelineSignal('skipped').tone).toBe('neutral')
    expect(pipelineSignal('completed').tone).toBe('neutral')
    expect(pipelineSignal('IN_PROGRESS')).toEqual({
      label: 'Running',
      tone: 'info',
      phase: 'active',
    })
    expect(pipelineSignal('newProviderState').label).toBe('New provider state')
    expect(pipelineSignal('').label).toBe('Unknown')
  })
})

describe('pipeline timing', () => {
  const startedAt = '2026-09-20T10:00:00Z'
  it.each([
    [0, '0s'],
    [59000, '59s'],
    [61000, '1m 1s'],
    [3661000, '1h 1m'],
    [90000000, '1d 1h'],
  ])('formats a completed duration of %i ms', (elapsed, expected) => {
    const completedAt = new Date(Date.parse(startedAt) + elapsed).toISOString()
    expect(pipelineDuration({ status: 'success', startedAt, completedAt })).toBe(expected)
  })
  it('uses elapsed time only while active and ignores bad timestamps', () => {
    const now = Date.parse(startedAt) + 125000
    expect(pipelineDuration({ status: 'in_progress', startedAt }, now)).toBe('2m 5s')
    expect(pipelineDuration({ status: 'failed', startedAt }, now)).toBeUndefined()
    expect(pipelineDuration({ status: 'unknown', startedAt }, now)).toBeUndefined()
    expect(pipelineDuration({ status: 'running' }, now)).toBeUndefined()
    expect(pipelineDuration({ status: 'running', startedAt: 'invalid' }, now)).toBeUndefined()
    expect(pipelineDuration({ status: 'running', startedAt }, now - 130000)).toBeUndefined()
    expect(pipelineDuration({ status: 'success', startedAt, completedAt: 'bad' })).toBeUndefined()
  })
})

describe('work item identifiers and search', () => {
  it('formats numeric issue IDs without changing Jira keys', () => {
    expect(issueLabel('123')).toBe('#123')
    expect(issueLabel('STUDIO-123')).toBe('STUDIO-123')
    expect(issueLabel('#123')).toBe('#123')
  })

  it('matches multiple terms across issue metadata', () => {
    const issue = forgeIssueSchema.parse({
      id: '123',
      title: 'Repair cancellation',
      body: '',
      state: 'open',
      type: 'Bug',
      url: 'https://github.com/me/app/issues/123',
      author: 'Dominic',
      assignees: ['Taylor'],
      labels: ['priority-high'],
      updatedAt: '',
      revision: '1',
    })
    expect(matchesWorkItem(issue, ' #123 REPAIR dominic Taylor priority-high bug open ')).toBe(true)
    expect(matchesWorkItem(issue, 'repair absent')).toBe(false)
    expect(matchesWorkItem(issue, ' ')).toBe(true)
    expect(matchesWorkItem({ ...issue, id: 'STUDIO-123' }, 'studio-123 repair')).toBe(true)
  })

  it('matches pipeline branches, commits, actors and definitions', () => {
    const run = forgePipelineSchema.parse({
      id: '5',
      title: 'Deploy preview',
      url: 'https://github.com/me/app/actions/runs/5',
      ref: 'feature/cancel',
      sha: 'abcdef123456',
      actor: 'Dominic',
      status: 'in_progress',
      createdAt: '',
      updatedAt: '',
      definition: 'preview.yaml',
      number: '1042',
      workflow: 'Deploy site',
      event: 'workflow_dispatch',
      commitMessage: 'Fix cancellation',
    })
    expect(matchesWorkItem(run, '5 deploy feature/cancel abcdef dominic preview.yaml')).toBe(true)
    expect(matchesWorkItem(run, 'deploy production')).toBe(false)
    expect(matchesWorkItem(run, '1042 site dispatch cancellation')).toBe(true)
  })
})
