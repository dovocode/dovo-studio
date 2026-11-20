import { expect, it } from 'vite-plus/test'
import {
  lineCommentRecoveryAllowsPost,
  lineCommentRecoveryMessage,
  lineCommentRecoveryNeedsChoice,
  lineCommentRecoveryReusesId,
  lineCommentRecoveryState,
} from './line-comment-recovery'

it('offers Post only for a fresh or rejected ID, and asks before posting an unconfirmed one', () => {
  expect(lineCommentRecoveryAllowsPost(undefined)).toBe(true)
  expect(lineCommentRecoveryAllowsPost({ status: 'rejected' })).toBe(true)
  const posted = { status: 'posted' as const, url: 'https://github.com/o/r/pull/1' }
  for (const recovery of [
    { status: 'checking' as const },
    { status: 'pending' as const },
    { status: 'check-failed' as const },
    posted,
  ]) {
    expect(lineCommentRecoveryAllowsPost(recovery)).toBe(false)
    expect(lineCommentRecoveryNeedsChoice(recovery)).toBe(false)
  }
  // Receipts belong to one pairing on one runtime database. Unknown is not proof it never posted.
  for (const status of ['unknown', 'uncertain', 'legacy'] as const) {
    expect(lineCommentRecoveryAllowsPost({ status })).toBe(false)
    expect(lineCommentRecoveryNeedsChoice({ status })).toBe(true)
    expect(lineCommentRecoveryMessage({ status })).toContain('Check the pull request')
  }
  expect(lineCommentRecoveryMessage({ status: 'unknown' })).toContain('renewed pairing')
  // Without an outcome the retry keeps its ID. A rejected or uncertain ID repeats its error.
  expect(lineCommentRecoveryReusesId({ status: 'unknown' })).toBe(true)
  expect(lineCommentRecoveryReusesId({ status: 'legacy' })).toBe(true)
  expect(lineCommentRecoveryReusesId({ status: 'uncertain' })).toBe(false)
  expect(lineCommentRecoveryReusesId({ status: 'rejected' })).toBe(false)
  expect(lineCommentRecoveryMessage({ status: 'rejected' })).toBeUndefined()
  expect(lineCommentRecoveryMessage(undefined)).toBeUndefined()
})

it('checks a saved ID in the first render, before any result arrives', () => {
  const base = {
    submissionId: 'saved',
    posting: undefined,
    receipts: true,
    connected: true,
    checked: undefined,
    check: 0,
  }
  expect(lineCommentRecoveryState(base)).toEqual({ status: 'checking' })
  expect(lineCommentRecoveryAllowsPost(lineCommentRecoveryState(base))).toBe(false)
  // This editor's own press needs no check while it is sending.
  expect(lineCommentRecoveryState({ ...base, posting: 'saved' })).toBeUndefined()
  expect(lineCommentRecoveryState({ ...base, submissionId: undefined })).toBeUndefined()
  // Offline, posting waits for a successful check.
  expect(lineCommentRecoveryState({ ...base, connected: false })).toEqual({
    status: 'check-failed',
  })
  // An older runtime cannot answer, so the editor shows its limit.
  expect(lineCommentRecoveryState({ ...base, receipts: false })).toEqual({ status: 'legacy' })
  const posted = { status: 'posted' as const, url: 'https://github.com/o/r/pull/1' }
  const checked = { id: 'saved', check: 0, value: posted }
  expect(lineCommentRecoveryState({ ...base, checked })).toEqual(posted)
  // A result for another ID, or from before Check again, is not used.
  expect(lineCommentRecoveryState({ ...base, checked: { ...checked, id: 'other' } })).toEqual({
    status: 'checking',
  })
  expect(lineCommentRecoveryState({ ...base, checked, check: 1 })).toEqual({ status: 'checking' })
})
