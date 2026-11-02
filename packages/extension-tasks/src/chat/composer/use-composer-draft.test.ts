import { expect, test } from 'vite-plus/test'
import type { Dispatch, SetStateAction } from 'react'
import type { Workspace } from '@dovo/studio-core'
import { createComposerDraft } from './composer-draft'
import { saveDraft } from './use-composer-draft'

const workspaceWith = (draft: string) =>
  ({ tasks: [{ id: 'task', draft }] }) as unknown as Workspace
function store(initial: Workspace) {
  let workspace = initial
  const setWorkspace: Dispatch<SetStateAction<Workspace>> = (value) => {
    workspace = typeof value === 'function' ? value(workspace) : value
  }
  return { setWorkspace, draft: () => workspace.tasks[0].draft }
}

test('a delayed send result from a left thread cannot clear its newer draft', () => {
  const saved = store(workspaceWith('Ship it'))
  // The first composer sent "Ship it"; the thread was then left and reopened.
  const stale = createComposerDraft('Ship it', saveDraft(saved.setWorkspace, 'task'))
  const reopened = createComposerDraft('Ship it', saveDraft(saved.setWorkspace, 'task'))
  reopened.update('Ship it after the review')
  reopened.flush()
  stale.accept('Ship it')
  expect(saved.draft()).toBe('Ship it after the review')
  expect(reopened.receive(saved.draft())).toBe('Ship it after the review')
})

test('a send result still clears the draft when nothing newer was saved', () => {
  const saved = store(workspaceWith('Ship it'))
  const composer = createComposerDraft('Ship it', saveDraft(saved.setWorkspace, 'task'))
  composer.accept('Ship it')
  expect(saved.draft()).toBe('')
})
