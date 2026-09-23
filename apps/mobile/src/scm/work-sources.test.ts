import { decode } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import { runtimeProfile, snapshotSchema, type RuntimeOverview } from '@dovo/protocol'
import {
  retainWorkPages,
  workSourceContentIdentity,
  workSourceIdentity,
  workSourceInput,
  workSources,
} from './work-sources'
import { workCacheKey } from './work-cache'
const jira = {
  id: 'general',
  site: 'https://team.atlassian.net',
  project: 'TEAM',
  name: 'General work',
}
function overview(host: string): RuntimeOverview {
  return {
    profile: runtimeProfile(
      {
        address: `http://${host}:51464`,
        token: `${host}-device-credential`,
      },
      host,
    ),
    connected: true,
    lastSeen: null,
    error: null,
    pulls: null,
    pullError: null,
    snapshot: decode(snapshotSchema, {
      revision: 1,
      owner: false,
      workspace: {
        version: 1,
        runtimeAddress: '',
        repositories: [],
        agents: [],
        automations: [],
        tasks: [],
        jiraSources: [jira],
      },
      approvals: [],
      questions: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    }),
  }
}
it('browses Jira without any code projects and keeps pipeline sources repository-only', () => {
  const entry = overview('laptop')
  const sources = workSources([entry], 'issues')
  expect(sources).toHaveLength(1)
  expect(workSourceInput(sources[0])).toEqual({
    jiraSourceId: 'general',
  })
  expect(workSources([entry], 'pipelines')).toEqual([])
})
it('keeps identical Jira source and issue IDs separate across computers', () => {
  const sources = workSources([overview('laptop'), overview('desktop')], 'issues')
  expect(new Set(sources.map((source) => source.key)).size).toBe(2)
  expect(new Set(sources.map(workSourceContentIdentity)).size).toBe(2)
})
it('does not refetch or remove issues when a Dovo project link changes', () => {
  const entry = overview('laptop')
  const before = workSources([entry], 'issues')
  const updated = {
    ...entry,
    snapshot: {
      ...entry.snapshot!,
      workspace: {
        ...entry.snapshot!.workspace,
        jiraIssueLinks: [
          {
            sourceId: 'general',
            issueId: 'TEAM-42',
            repositoryId: 'code',
          },
        ],
      },
    },
  }
  const after = workSources([updated], 'issues')
  expect(workSourceIdentity(before)).toBe(workSourceIdentity(after))
  expect(
    retainWorkPages(
      [
        {
          source: before[0],
          items: ['TEAM-42'],
        },
      ],
      after,
    )[0]?.items,
  ).toEqual(['TEAM-42'])
})
it('retains saved Jira issues offline but drops removed or reauthenticated sources', () => {
  const entry = overview('laptop')
  const before = workSources([entry], 'issues')
  const pages = [
    {
      source: before[0],
      items: ['TEAM-42'],
    },
  ]
  expect(
    retainWorkPages(
      pages,
      workSources(
        [
          {
            ...entry,
            connected: false,
          },
        ],
        'issues',
      ),
    )[0]?.source.connected,
  ).toBe(false)
  expect(retainWorkPages(pages, [])).toEqual([])
  const replaced = {
    ...entry,
    profile: {
      ...entry.profile,
      connection: {
        ...entry.profile.connection,
        token: 'new-token',
      },
    },
  }
  expect(retainWorkPages(pages, workSources([replaced], 'issues'))).toEqual([])
})
it('keeps Jira cache separate from repository cache and namespace changes', () => {
  const keys = [
    workCacheKey(jira, 'issues', 'detail', {
      id: 'TEAM-42',
    }),
    workCacheKey(
      {
        ...jira,
        site: 'https://other.atlassian.net',
      },
      'issues',
      'detail',
      {
        id: 'TEAM-42',
      },
    ),
    workCacheKey(
      {
        ...jira,
        project: 'OTHER',
      },
      'issues',
      'detail',
      {
        id: 'TEAM-42',
      },
    ),
    workCacheKey(
      {
        id: 'general',
        path: '/code',
      },
      'issues',
      'detail',
      {
        id: 'TEAM-42',
      },
    ),
  ]
  expect(new Set(keys).size).toBe(keys.length)
})
