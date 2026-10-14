import * as jiraContext from '../forges/providers/jira-context.js'
import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test'
import { decode, commandsSchema, forgeSourceIdentitySchema } from '@dovo/protocol'
import { openDatabase } from '../../storage/database'
import { WorkspaceStore } from '../../storage/workspace'
import { ForgeWork } from './forge-work'
import { GitService } from '../git/git'
import { ForgeConnections } from '../forges/integration/forge-connections'
import { ForgePullRequests } from '../forges/integration/forge-pulls'
import type { runForgeCli } from '../forges/integration/forge-cli'
beforeEach(() =>
  vi.spyOn(jiraContext, 'captureJiraContext').mockResolvedValue({
    env: { ACLI_CONFIG_DIR: '/fixture/pinned-jira' },
    accountId: (_site, email) => email.toLowerCase(),
    close: async () => {},
  }),
)
const cleanup: Array<() => void> = []
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose()
  vi.restoreAllMocks()
})
function setup() {
  const db = openDatabase(':memory:')
  cleanup.push(() => db.close())
  const store = new WorkspaceStore(db)
  const source = {
    id: 'jira',
    site: 'https://first.atlassian.net',
    project: 'TEAM',
    name: 'First site',
  }
  store.update((w) => ({ ...w, jiraSources: [source] }))
  const git = new GitService()
  const connections = new ForgeConnections(db)
  let site = 'first.atlassian.net'
  let email = 'first@example.com'
  let interrupt = false
  const run = vi.fn<typeof runForgeCli>().mockImplementation(async (_cmd, args) => {
    if (args.includes('auth'))
      return `Authenticated\nSite: ${site}\nEmail: ${email}\nAuthentication Type: oauth`
    if (args.includes('project'))
      return JSON.stringify({
        key: 'TEAM',
        self: 'https://api.atlassian.com/project/1',
        issueTypes: [],
      })
    if (args.includes('search')) {
      if (interrupt) email = 'second@example.com'
      return JSON.stringify([
        {
          id: '1',
          key: 'TEAM-1',
          self: 'https://api.atlassian.com/issue/1',
          fields: {
            summary: 'Private work',
            description: '',
            status: { name: 'Open' },
            issuetype: { name: 'Task' },
            updated: 'same-revision',
          },
        },
      ])
    }
    throw new Error('Unexpected provider write')
  })
  const work = new ForgeWork(
    db,
    store,
    git,
    connections,
    new ForgePullRequests(git, connections, store),
    () => decode(commandsSchema, {}),
    run,
  )
  return {
    db,
    store,
    work,
    run,
    setSite: (value: string) => {
      site = value
    },
    setEmail: (value: string) => {
      email = value
    },
    interrupt: () => {
      interrupt = true
    },
  }
}
it('does not reuse warmed Jira account/site verification to authorize mutations', async () => {
  const f = setup()
  const before = decode(forgeSourceIdentitySchema, await f.work.sourceIdentityJira('jira'))
  await f.work.requestJira('jira', 'issues/list', {})
  f.setEmail('second@example.com')
  await expect(
    f.work.requestJira('jira', 'issues/create', {
      title: 'Keep draft',
      body: '',
      expectedDestination: before.destination,
    }),
  ).rejects.toThrow('destination or account changed')
  f.setSite('second.atlassian.net')
  await expect(
    f.work.requestJira('jira', 'issues/create', { title: 'Keep draft', body: '' }),
  ).rejects.toThrow('another Jira site')
  expect(
    f.run.mock.calls.some(([, args]) =>
      ['create', 'edit', 'switch', 'transition'].some((command) => args.includes(command)),
    ),
  ).toBe(false)
})
it('excludes cosmetic Jira names and auth-status decoration from stable destination identity', async () => {
  const f = setup()
  const first = await f.work.sourceIdentityJira('jira')
  f.store.update((w) => ({
    ...w,
    jiraSources: w.jiraSources?.map((source) => ({ ...source, name: 'Renamed' })),
  }))
  const second = await f.work.sourceIdentityJira('jira')
  expect(second).toEqual(first)
  expect(JSON.stringify(second)).not.toContain('first@example.com')
  f.setEmail('FIRST@EXAMPLE.COM')
  expect(await f.work.sourceIdentityJira('jira')).toEqual(first)
  f.setEmail('second@example.com')
  expect((await f.work.sourceIdentityJira('jira')).readerIdentity).not.toBe(first.readerIdentity)
})
it('rejects an interrupted account read before private results can enter the Jira cache', async () => {
  const f = setup()
  f.interrupt()
  await expect(f.work.requestJira('jira', 'issues/list', {})).rejects.toThrow(
    'site or account changed',
  )
  expect(f.db.prepare('SELECT count(*) AS count FROM forge_work_cache').get()).toEqual({ count: 0 })
})
it('rejects a discovered reader after an account switch before loading private issue data', async () => {
  const f = setup()
  const first = await f.work.sourceIdentityJira('jira')
  f.setEmail('second@example.com')
  await expect(
    f.work.requestJira('jira', 'issues/list', { expectedReaderIdentity: first.readerIdentity }),
  ).rejects.toThrow('reader account changed')
  expect(f.run.mock.calls.some(([, args]) => args.includes('search'))).toBe(false)
})
it('awaits the verified Jira account ID and distinguishes two accounts at the same site and email', async () => {
  const f = setup()
  let accountId = 'account-one'
  vi.spyOn(jiraContext, 'captureJiraContext').mockImplementation(async () => ({
    env: { ACLI_CONFIG_DIR: '/fixture/pinned-jira' },
    accountId: async () => accountId,
    close: async () => {},
  }))
  const first = await f.work.sourceIdentityJira('jira')
  accountId = 'account-two'
  const second = await f.work.sourceIdentityJira('jira')
  expect(second.readerIdentity).not.toBe(first.readerIdentity)
  expect(second.destination).not.toBe(first.destination)
  await expect(
    f.work.requestJira('jira', 'issues/create', {
      title: 'Keep draft',
      body: '',
      expectedDestination: first.destination,
    }),
  ).rejects.toThrow('destination or account changed')
  expect(f.run.mock.calls.some(([, args]) => args.includes('create'))).toBe(false)
})
