import { expect, it } from 'vite-plus/test'
import { checkpointFiles, filePreviewLabel, undoBackupTurn } from './file-previews'
import { decode } from '../../shared/schema'
import { fileSchema, type TaskTurn } from '../../workspace'

it('keeps older binary paths selectable without duplicating files or treating them as text', () => {
  const text = { path: 'code.ts', before: 'a', after: 'b', viewed: false }
  const files = checkpointFiles({ files: [text], omitted: ['icon.png', 'code.ts'] })
  expect(files).toHaveLength(2)
  expect(files[0]).toBe(text)
  expect(files[1]).toMatchObject({ path: 'icon.png', preview: { kind: 'deferred' } })
  expect(filePreviewLabel(files[1])).toBe('Preview loads when opened')
})
it('preserves saved metadata when changed files pass through the protocol', () => {
  const file = {
    path: 'icon.png',
    before: '',
    after: '',
    viewed: false,
    preview: { kind: 'image', after: { size: 123, hash: 'blob', mode: '100644' } },
  }
  expect(decode(fileSchema, file)).toEqual(file)
})

it('prioritizes durable pending undo recovery over newer completed turns', () => {
  const turn: TaskTurn = {
    id: 'pending',
    assistantId: 'reply',
    agentId: 'agent',
    provider: 'codex',
    model: '',
    status: 'completed',
    startedAt: 'now',
    checkpoint: {
      before: 'before',
      after: 'after',
      files: [{ path: 'hello.txt', before: 'a', after: 'b', viewed: false }],
      omitted: [],
      restorePending: true,
      undone: { at: 'now', backup: 'backup' },
    },
  }
  const newer: TaskTurn = {
    ...turn,
    id: 'newer',
    checkpoint: { ...turn.checkpoint!, restorePending: undefined, undone: undefined },
  }
  expect(undoBackupTurn([turn, newer])?.id).toBe('pending')
  const shared: TaskTurn = {
    ...newer,
    id: 'shared',
    checkpoint: { ...newer.checkpoint!, sharedCheckout: true },
  }
  expect(undoBackupTurn([newer, shared])).toBeUndefined()
  expect(undoBackupTurn([turn, newer, shared])?.id).toBe('pending')
  expect(undoBackupTurn([shared, newer])).toBeUndefined()
  expect(
    undoBackupTurn([
      { ...turn, checkpoint: { ...turn.checkpoint!, restorePending: undefined } },
      newer,
    ])?.id,
  ).toBe('pending')
})
