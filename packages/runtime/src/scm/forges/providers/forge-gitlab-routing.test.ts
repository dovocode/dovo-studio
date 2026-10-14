import { afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, repositorySchema } from '@dovo/protocol'
import { openDatabase } from '../../../storage/database'
import { WorkspaceStore } from '../../../storage/workspace'
import { GitService } from '../../git/git'
import { ForgeConnections } from '../integration/forge-connections'
import { ForgePullRequests } from '../integration/forge-pulls'

const db = openDatabase(':memory:')
const store = new WorkspaceStore(db)
const connections = new ForgeConnections(db)
const git = new GitService()
const pulls = new ForgePullRequests(git, connections, store)
const sha = 'a'.repeat(40)
afterEach(() => {
  vi.unstubAllGlobals()
  db.prepare('DELETE FROM forge_connections').run()
})

it('verifies GitLab readers independently of local IDs and rejects rebound actions before dispatch', async () => {
  const writes: string[] = []
  const input = {
    name: 'Lab',
    provider: 'gitlab',
    baseUrl: 'http://gitlab.local:3000',
    credential: 'token',
    token: 'fixture-token',
  }
  const first = connections.save(input),
    second = connections.save({ ...input, name: 'Same account elsewhere' })
  const project = decode(repositorySchema, {
    id: 'app',
    name: 'App',
    path: '/fixture',
    branch: 'main',
    forge: { connectionId: first.id, repository: 'team/sub/app' },
  })
  store.update((workspace) => ({ ...workspace, repositories: [project] }))
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-token')
      if (init?.method !== 'GET') writes.push(url.pathname)
      if (url.pathname === '/api/v4/user') return Response.json({ id: 7, username: 'dominic' })
      return Response.json({
        iid: 42,
        title: 'Change',
        web_url: 'http://gitlab.local:3000/team/sub/app/-/merge_requests/42',
        state: 'opened',
        author: { id: 7, username: 'dominic' },
        labels: [],
        updated_at: '',
        source_branch: 'topic',
        target_branch: 'main',
        sha,
        source_project_id: 1,
      })
    }),
  )
  const original = await pulls.sourceIdentity(project.path)
  store.update((workspace) => ({
    ...workspace,
    repositories: [{ ...project, forge: { connectionId: second.id, repository: 'team/sub/app' } }],
  }))
  const alternative = await pulls.sourceIdentity(project.path)
  expect(alternative.readerIdentity).toBe(original.readerIdentity)
  expect(alternative.destination).not.toBe(original.destination)
  await expect(
    pulls.act(project.path, {
      action: 'close',
      number: 42,
      headSha: sha,
      expectedDestination: original.destination,
    }),
  ).rejects.toThrow('destination')
  expect(writes).toEqual([])
  await pulls.act(project.path, {
    action: 'close',
    number: 42,
    headSha: sha,
    expectedDestination: alternative.destination,
  })
  expect(writes).toEqual(['/api/v4/projects/team%2Fsub%2Fapp/merge_requests/42'])
})
