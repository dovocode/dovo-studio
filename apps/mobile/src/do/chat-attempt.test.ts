import { describe, expect, it, vi } from 'vite-plus/test'
import { decode, doChatCreateRequestSchema, ValidationError } from '@dovo/protocol'
import { doChatAttempt } from './chat-attempt'
import { doPlansHref } from './route'
import { taskHref } from '../shell/task-route'

const firstId = '63b56ca3-d6ae-4c19-9c0d-4ab387de42e0'
const nextId = 'c84b590e-8330-444e-928b-843e275422a5'

describe('mobile Do chat creation', () => {
  it('retains the UUID and exact request after a lost reply and a snapshot refresh', () => {
    const uuid = vi.fn<() => string>(() => firstId)
    const draft = { text: 'Help me plan the release', repositoryId: 'project', agentId: 'agent' }
    const attempt = doChatAttempt(null, 'plan-home', draft, uuid)
    const retry = doChatAttempt(attempt, 'plan-home', { ...draft }, uuid)
    expect(retry).toBe(attempt)
    expect(uuid).toHaveBeenCalledTimes(1)
    expect(decode(doChatCreateRequestSchema, retry.input)).toEqual({ id: firstId, ...draft })
  })

  it.each([
    ['edited goal', 'home', { text: 'Ship the new release' }],
    ['different computer', 'other', { text: 'Plan a release' }],
    ['different agent', 'home', { text: 'Plan a release', agentId: 'custom' }],
    ['different project', 'home', { text: 'Plan a release', repositoryId: 'project' }],
  ])('starts a new request for %s', (_reason, runtimeId, draft) => {
    const attempt = doChatAttempt(null, 'home', { text: 'Plan a release' }, () => firstId)
    const next = doChatAttempt(attempt, runtimeId, draft, () => nextId)
    expect(next.input.id).toBe(nextId)
    expect(attempt.input.id).toBe(firstId)
  })

  it('sends plain initial text without requiring a project or agent', () => {
    const attempt = doChatAttempt(
      null,
      'home',
      { text: 'What should I tackle today?' },
      () => firstId,
    )
    expect(attempt.input).toEqual({ id: firstId, text: 'What should I tackle today?' })
  })

  it('validates before a request can be sent', () => {
    expect(() => doChatAttempt(null, 'home', { text: '   ' }, () => firstId)).toThrow(
      ValidationError,
    )
  })
})

describe('Do chat and plan review routes', () => {
  it('retains the owning phone profile for both conversation and exact plan links', () => {
    expect(taskHref('paired-home', 'task')).toEqual({
      pathname: '/(tasks)/thread/[runtimeId]/[taskId]',
      params: { runtimeId: 'paired-home', taskId: 'task' },
    })
    expect(doPlansHref('paired-home', firstId)).toEqual({
      pathname: '/settings/do-plans',
      params: { runtimeId: 'paired-home', runId: firstId },
    })
    expect(doPlansHref('other-home', firstId).params.runtimeId).toBe('other-home')
    expect(doPlansHref('paired-home').params).toEqual({ runtimeId: 'paired-home' })
  })
})
