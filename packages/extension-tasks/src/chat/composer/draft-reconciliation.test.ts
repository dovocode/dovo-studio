import { expect, it } from 'vite-plus/test'
import { reconcileComposerDraft } from './draft-reconciliation'
it('keeps newer typing when an older draft or acknowledgement arrives', () => {
  expect(reconcileComposerDraft('Next message', 'Sent message', '', 'Sent message')).toBe(
    'Next message',
  )
  expect(reconcileComposerDraft('Typing now', 'Old draft', 'Older draft', null)).toBe('Typing now')
})
it('does not resurrect submitted text but accepts a new external draft while idle', () => {
  expect(reconcileComposerDraft('', '', 'Sent message', 'Sent message')).toBe('')
  expect(reconcileComposerDraft('', '', 'Side chat answer', 'Sent message')).toBe(
    'Side chat answer',
  )
})
