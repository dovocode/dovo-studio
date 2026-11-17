import { expect, it, vi } from 'vite-plus/test'
import { runClientEffect } from '@dovo/client-runtime'
import type { ChatMessage } from '@dovo/protocol'
import { createDraftStorage } from './storage'
import {
  observeQueueEdit,
  prepareQueueEdit,
  settleQueueEdit,
  startQueueEdit,
  type QueueEdit,
} from './queue-edit'

const editKey = 'dovo.queue-edit.computer.thread'
const draftKey = 'dovo.draft.computer.thread'
const ordinaryDraft = 'Unsent follow-up'
const originalFileId = '00000000-0000-4000-8000-000000000001'
const newFileId = '00000000-0000-4000-8000-000000000002'
const original: ChatMessage = {
  id: 'message',
  role: 'user',
  text: 'Before editing',
  attachments: [{ id: originalFileId, name: 'original.txt', mime: 'text/plain', size: 1 }],
  turnSettings: { provider: 'codex', model: 'original-model', reasoning: '' },
}
const intended: ChatMessage = {
  ...original,
  text: 'After editing',
  attachments: [{ id: newFileId, name: 'new.txt', mime: 'text/plain', size: 2 }],
  turnSettings: { provider: 'codex', model: 'new-model', reasoning: 'high' },
  plan: true,
}
const support = { attachments: true, settings: true, plan: true }
const pending = (): QueueEdit & { attempt: NonNullable<QueueEdit['attempt']> } => {
  const edit = {
    ...startQueueEdit(original, 'session'),
    draft: startQueueEdit(intended, 'session').draft,
  }
  const { attempt } = prepareQueueEdit(edit, 'thread', intended.text, 'attempt', support)
  return { ...edit, attempt }
}
function savedDrafts(edit: QueueEdit) {
  const values = new Map([
    [draftKey, ordinaryDraft],
    [editKey, `dovo-draft-record-v1:${JSON.stringify({ text: '', queueEdit: edit })}`],
  ])
  return {
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: async (key: string) => {
      values.delete(key)
    },
  }
}

it('reloads the edit and its pending save on navigation without changing the ordinary draft', async () => {
  const edit = pending()
  const storage = savedDrafts(edit)
  const drafts = createDraftStorage(storage)
  expect(await runClientEffect(drafts.readRecordEffect(editKey))).toMatchObject({ queueEdit: edit })
  const receive = vi.fn<(edit: QueueEdit | undefined) => void>()
  const leave = drafts.subscribeQueueEdit(editKey, receive)
  const typed = { ...edit, version: 1, draft: { ...edit.draft, text: 'More typing' } }
  const write = runClientEffect(drafts.updateQueueEditEffect(editKey, () => typed))
  leave()
  await write
  await drafts.write(draftKey, 'New ordinary draft')
  const reopened = createDraftStorage(storage)
  expect(await runClientEffect(reopened.readRecordEffect(editKey))).toMatchObject({
    queueEdit: typed,
  })
  expect(await reopened.read(draftKey)).toBe('New ordinary draft')
  await runClientEffect(reopened.updateQueueEditEffect(editKey, () => undefined))
  expect(
    await runClientEffect(createDraftStorage(storage).readRecordEffect(editKey)),
  ).not.toHaveProperty('queueEdit')
  expect(await reopened.read(draftKey)).toBe('New ordinary draft')
})

it('keeps the latest edit after a failed disk write and flushes it without touching the ordinary draft', async () => {
  const edit = pending()
  const storage = savedDrafts(edit)
  let fail = true
  const drafts = createDraftStorage({
    ...storage,
    setItem: async (key, value) => {
      if (key === editKey && fail) throw new Error('Storage unavailable')
      await storage.setItem(key, value)
    },
  })
  expect(await runClientEffect(drafts.readRecordEffect(editKey))).toMatchObject({ queueEdit: edit })
  const typed = { ...edit, version: 1, draft: { ...edit.draft, text: 'Newest typing' } }
  const receive = vi.fn<(edit: QueueEdit | undefined) => void>()
  const leave = drafts.subscribeQueueEdit(editKey, receive)
  await expect(runClientEffect(drafts.updateQueueEditEffect(editKey, () => typed))).rejects.toThrow(
    'Storage unavailable',
  )
  expect(receive).toHaveBeenCalledWith(typed)
  leave()
  expect(await runClientEffect(drafts.readRecordEffect(editKey))).toMatchObject({
    queueEdit: typed,
  })
  fail = false
  await runClientEffect(drafts.flushEffect())
  const reopened = createDraftStorage(storage)
  expect(await runClientEffect(reopened.readRecordEffect(editKey))).toMatchObject({
    queueEdit: typed,
  })
  expect(await reopened.read(draftKey)).toBe(ordinaryDraft)
})

it.each([
  ['original', original],
  ['saved', intended],
  ['conflict', { ...intended, attachments: original.attachments }],
  ['conflict', { ...intended, turnSettings: original.turnSettings }],
  ['conflict', { ...intended, plan: false }],
  ['removed', undefined],
] as const)(
  'reconciles a lost reply as %s and preserves unresolved edits',
  async (expected, fresh) => {
    const edit = pending()
    const storage = savedDrafts(edit)
    const drafts = createDraftStorage(storage)
    const record = await runClientEffect(drafts.readRecordEffect(editKey))
    expect(record).toMatchObject({ queueEdit: edit })
    const observed = observeQueueEdit(edit, edit.attempt, fresh)
    expect(observed).toBe(expected)
    await runClientEffect(
      drafts.updateQueueEditEffect(editKey, (current) =>
        observed === 'saved' || observed === 'original'
          ? settleQueueEdit(current, edit.session, edit.attempt, observed === 'saved')
          : current,
      ),
    )
    const reopened = await runClientEffect(createDraftStorage(storage).readRecordEffect(editKey))
    expect(reopened?.queueEdit).toEqual(
      expected === 'saved'
        ? undefined
        : expected === 'original'
          ? { ...edit, attempt: undefined }
          : edit,
    )
    expect(await drafts.read(draftKey)).toBe(ordinaryDraft)
  },
)

it('keeps newer text and rebases its original when an older save is confirmed', async () => {
  const edit = pending()
  const storage = savedDrafts(edit)
  const drafts = createDraftStorage(storage)
  expect(await runClientEffect(drafts.readRecordEffect(editKey))).toMatchObject({ queueEdit: edit })
  const typed = { ...edit, version: 1, draft: { ...edit.draft, text: 'More typing' } }
  await runClientEffect(drafts.updateQueueEditEffect(editKey, () => typed))
  const saved = await runClientEffect(
    drafts.updateQueueEditEffect(editKey, (current) =>
      settleQueueEdit(current, edit.session, edit.attempt, true),
    ),
  )
  expect(saved).toEqual({ ...typed, original: edit.attempt.intended, attempt: undefined })
  expect(prepareQueueEdit(saved!, 'thread', typed.draft.text, 'next', support).input).toMatchObject(
    {
      text: 'More typing',
      expectedText: intended.text,
      expectedAttachmentIds: [newFileId],
      expectedTurnSettings: intended.turnSettings,
      expectedPlan: true,
    },
  )

  const replacement = startQueueEdit(original, 'next-session')
  await runClientEffect(drafts.updateQueueEditEffect(editKey, () => replacement))
  expect(
    await runClientEffect(
      drafts.updateQueueEditEffect(editKey, (current) =>
        settleQueueEdit(current, edit.session, edit.attempt, true),
      ),
    ),
  ).toEqual(replacement)
  expect(await drafts.read(draftKey)).toBe(ordinaryDraft)
})
