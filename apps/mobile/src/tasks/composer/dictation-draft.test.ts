import { describe, expect, it } from 'vite-plus/test'
import { DictationDraftEdit, dictationInsertion } from './dictation-draft'

describe('dictation draft edits', () => {
  it('preserves typed context and revises only the dictated fragment', () => {
    const edit = new DictationDraftEdit('Update packages/runtime:')
    expect(edit.preview('uh fix it')).toBe('Update packages/runtime: uh fix it')
    const raw = edit.preview('uh fix the WebSocket reconnect')
    expect(edit.clean(raw, 'Fix the WebSocket reconnect.')).toBe(
      'Update packages/runtime: Fix the WebSocket reconnect.',
    )
  })
  it('replaces the selection without changing surrounding code or punctuation', () => {
    const insert = dictationInsertion('In `useDraft`, replace THIS, please.', {
      start: 23,
      end: 27,
    })
    expect(insert('de cache')).toBe('In `useDraft`, replace de cache, please.')
  })
  it('keeps the draft intact when recognition has no words', () => {
    expect(dictationInsertion('Keep this', { start: 0, end: 9 })('')).toBe('Keep this')
  })
  it('never applies a delayed cleanup after typing, sending, undoing or changing tasks', () => {
    const edit = new DictationDraftEdit('')
    const raw = edit.preview('uh fix the cache')
    expect(edit.clean('New user text', 'Fix the cache.')).toBeNull()
    edit.invalidate()
    expect(edit.clean(raw, 'Fix the cache.')).toBeNull()
    expect(edit.clean('', 'Fix the cache.')).toBeNull()
  })
  it('retains multiline context and clamps a stale cursor position', () => {
    expect(dictationInsertion('Context:\n', { start: 300, end: 400 })('check auth')).toBe(
      'Context:\ncheck auth',
    )
  })
})
