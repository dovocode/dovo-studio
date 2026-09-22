import { expect, it } from 'vitest'
import type { Workspace } from '@dovo/protocol'
import { openDatabase } from './database.js'
import { WorkspaceStore } from './workspace.js'

it('migrates legacy repository bindings and linked tasks once, preserving independent sources', () => {
  const db = openDatabase(':memory:')
  try {
    const binding = { site: 'https://team.atlassian.net', project: 'TEAM' }
    const source = { ...binding, id: 'already-saved', name: 'Team planning' }
    const workspace: Workspace = {
      version: 1,
      runtimeAddress: '',
      agents: [],
      automations: [],
      jiraSources: [source],
      repositories: [
        { id: 'one', name: 'One', path: '/one', branch: 'main', jira: binding },
        { id: 'two', name: 'Two', path: '/two', branch: 'main', jira: binding },
      ],
      tasks: [
        {
          id: 'task',
          title: 'Work',
          repositoryId: 'two',
          agentId: '',
          status: 'draft',
          createdAt: '',
          messages: [],
          draft: '',
          files: [],
          example: false,
          workItem: {
            kind: 'issue',
            provider: 'jira',
            id: 'TEAM-1',
            url: `${binding.site}/browse/TEAM-1`,
            title: 'General work',
            revision: 'rev',
          },
        },
      ],
    }
    db.prepare('INSERT INTO documents VALUES (?, ?)').run('workspace', JSON.stringify(workspace))
    const store = new WorkspaceStore(db)
    expect(store.get().jiraSources).toEqual([source])
    expect(store.get().repositories.every((repository) => !repository.jira)).toBe(true)
    expect(store.task('task').workItem).toMatchObject({ jiraSourceId: source.id })
    expect(store.get().jiraIssueLinks).toEqual([
      { sourceId: source.id, issueId: 'TEAM-1', repositoryId: 'two' },
    ])
    expect(new WorkspaceStore(db).get()).toEqual(store.get())
    // Old workspace imports are normalized by the same path as persisted load.
    store.update(() => ({ ...workspace, jiraSources: undefined }))
    expect(store.get().jiraSources).toHaveLength(1)
    expect(new WorkspaceStore(db).get()).toEqual(store.get())
  } finally {
    db.close()
  }
})
