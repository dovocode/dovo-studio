import { expect, it } from 'vite-plus/test'
import { openDatabase } from '../../storage/database.js'
import { WorkspaceStore } from '../../storage/workspace.js'
import { TaskQueue } from './task-queue.js'

it('retains runtime message provenance through queue persistence and delivery, while edits and duplicates belong to the user', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new WorkspaceStore(db)
    store.update((workspace) => ({
      ...workspace,
      tasks: [
        {
          id: 'task',
          title: 'Work',
          repositoryId: '',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          files: [],
          draft: '',
          example: false,
        },
      ],
    }))
    const queue = new TaskQueue(store)
    const source = {
      kind: 'thread' as const,
      runtimeId: 'local',
      runtimeIdentity: 'computer',
      threadId: 'reviewer',
      title: 'Reviewer',
    }
    queue.add('task', 'message', 'Review these results', [], undefined, false, false, undefined, {
      source,
    })
    expect(new WorkspaceStore(db).task('task').queue?.[0].source).toEqual(source)
    queue.duplicate('task', 'message', 'copy')
    expect(store.task('task').queue?.find((message) => message.id === 'copy')?.source).toEqual({
      kind: 'user',
    })
    queue.take('task', 'turn')
    expect(new WorkspaceStore(db).task('task').messages[0].source).toEqual(source)
    queue.add('task', 'edit', 'Original request', [], undefined, false, false, undefined, {
      source,
    })
    queue.edit('task', 'edit', 'My changed request', 'Original request')
    expect(store.task('task').queue?.find((message) => message.id === 'edit')?.source).toEqual({
      kind: 'user',
    })
    expect(store.task('task').subagentInbox ?? []).toHaveLength(0)
  } finally {
    db.close()
  }
})
