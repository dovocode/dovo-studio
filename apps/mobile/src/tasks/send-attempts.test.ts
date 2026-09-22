import { describe, expect, it } from 'vite-plus/test'
import { createSendAttempts, type SendScope } from './send-attempts'

const scope: SendScope = { runtimeId: 'computer-a', taskId: 'task-1' }
const input = {
  text: 'Fix the failing build',
  attachmentIds: ['build-log'],
  mode: 'queue' as const,
}
function store() {
  let sequence = 0
  return createSendAttempts(() => `message-${++sequence}`)
}

describe('conversation send attempts across navigation', () => {
  it('reuses the message identity and title after a lost response and reopening the thread', async () => {
    const attempts = store()
    const accepted = new Map<string, string>()
    let loseResponse = true
    const send = async (messageId: string, text: string) => {
      if (!accepted.has(messageId)) accepted.set(messageId, text)
      if (loseResponse) throw new Error('Connection lost after acceptance')
    }
    const firstScreen = attempts.begin(scope, input)
    attempts.setTitle(scope, firstScreen.id, 'Fix failing build')
    await expect(
      attempts.deliver(scope, firstScreen, () => send(firstScreen.id, firstScreen.text)),
    ).rejects.toThrow('Connection lost')

    // The composer has unmounted; its replacement has no component-local retry state.
    const reopenedScreen = attempts.begin(scope, { ...input })
    expect(reopenedScreen.id).toBe(firstScreen.id)
    expect(reopenedScreen.title).toBe('Fix failing build')
    loseResponse = false
    expect(
      await attempts.deliver(scope, reopenedScreen, () =>
        send(reopenedScreen.id, reopenedScreen.text),
      ),
    ).toBe(true)
    expect(accepted.size).toBe(1)
    expect(attempts.begin(scope, input).id).not.toBe(firstScreen.id)
  })

  it('accepts snapshot confirmation before a late failed HTTP reply without reporting a retry error', async () => {
    const attempts = store()
    const attempt = attempts.begin(scope, input)
    // Title generation must retain the same delivery identity used by the outstanding request.
    attempts.setTitle(scope, attempt.id, 'Fix failing build')
    let rejectReply = (_error: Error) => {}
    const reply = new Promise<void>((_resolve, reject) => {
      rejectReply = reject
    })
    const delivery = attempts.deliver(scope, attempt, () => reply)
    expect(attempts.reconcile(scope, { text: input.text, attachmentIds: [] }, [attempt.id])).toBe(
      true,
    )
    rejectReply(new Error('HTTP reply was lost'))
    await expect(delivery).resolves.toBe(false)
    expect(attempts.isConfirmed(attempt)).toBe(true)
  })

  it('recognizes confirmation arriving after the failed reply was already reported', async () => {
    const attempts = store()
    const attempt = attempts.begin(scope, input)
    await expect(
      attempts.deliver(scope, attempt, async () => {
        throw new Error('HTTP reply was lost')
      }),
    ).rejects.toThrow('HTTP reply was lost')
    expect(attempts.isConfirmed(attempt)).toBe(false)
    expect(attempts.reconcile(scope, input, [attempt.id])).toBe(true)
    expect(attempts.isConfirmed(attempt)).toBe(true)
  })

  it('isolates the same task id on different computers and keeps the original retry when returning', () => {
    const attempts = store()
    const first = attempts.begin(scope, input)
    const other = { ...scope, runtimeId: 'computer-b' }
    const second = attempts.begin(other, input)
    expect(second.id).not.toBe(first.id)
    attempts.setTitle(other, second.id, 'Other computer title')
    attempts.acknowledge(other, second.id)
    expect(attempts.begin(scope, input)).toEqual(first)
    expect(attempts.begin({ ...scope, taskId: 'task-2' }, input).id).not.toBe(first.id)
  })

  it('starts a new attempt after actual wording changes, even when changed back before sending', () => {
    const attempts = store()
    const first = attempts.begin(scope, input)
    attempts.textChanged(scope, 'Fix the deployment instead')
    attempts.textChanged(scope, input.text)
    expect(attempts.begin(scope, input).id).not.toBe(first.id)
  })

  it('keeps a retry for whitespace that does not change the submitted text', () => {
    const attempts = store()
    const first = attempts.begin(scope, input)
    attempts.textChanged(scope, `\n${input.text}  `)
    expect(attempts.begin(scope, { ...input, text: ` ${input.text} ` }).id).toBe(first.id)
  })

  it('replaces attempts when their attachments or delivery mode change', () => {
    const attempts = store()
    const first = attempts.begin(scope, input)
    const changedFile = attempts.begin(scope, { ...input, attachmentIds: ['new-log'] })
    const steering = attempts.begin(scope, { ...input, mode: 'steer' })
    expect(new Set([first.id, changedFile.id, steering.id]).size).toBe(3)
  })

  it('does not let an older response or title clear or modify a newer attempt', () => {
    const attempts = store()
    const first = attempts.begin(scope, input)
    const newerInput = { ...input, text: 'Investigate the new failure' }
    const newer = attempts.begin(scope, newerInput)
    attempts.setTitle(scope, first.id, 'Stale title')
    expect(attempts.acknowledge(scope, first.id)).toBe(false)
    expect(attempts.begin(scope, newerInput)).toEqual(newer)
  })

  it('recognizes server acceptance before treating consumed draft attachments as an edit', () => {
    const attempts = store()
    const first = attempts.begin(scope, input)
    expect(attempts.reconcile(scope, { text: input.text, attachmentIds: [] }, [first.id])).toBe(
      true,
    )
    expect(attempts.acknowledge(scope, first.id)).toBe(false)
  })

  it('preserves new draft text or attachments when an earlier message is confirmed', () => {
    for (const changed of [
      { text: 'A new follow-up', attachmentIds: [] },
      { text: input.text, attachmentIds: ['another-file'] },
    ]) {
      const attempts = store()
      const first = attempts.begin(scope, input)
      expect(attempts.reconcile(scope, changed, [first.id])).toBe(false)
      expect(attempts.acknowledge(scope, first.id)).toBe(false)
    }
  })

  it('invalidates attachment edits while keeping an unacknowledged, unchanged draft', () => {
    const attempts = store()
    const first = attempts.begin(scope, input)
    expect(attempts.reconcile(scope, input, [])).toBe(false)
    expect(attempts.begin(scope, input).id).toBe(first.id)
    expect(attempts.reconcile(scope, { ...input, attachmentIds: [] }, [])).toBe(false)
    expect(attempts.begin(scope, input).id).not.toBe(first.id)
  })
})
