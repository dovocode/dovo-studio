import { expect, it, vi } from 'vite-plus/test'
import { decode, snapshotSchema, type RuntimeOverview } from '@dovo/protocol'
import { appLinkChoices } from './app-link-target'

vi.mock('expo-router', () => ({ router: {} }))
vi.mock('react-native', () => ({ Keyboard: { dismiss() {} } }))

function overview(id: string, identity = 'github.com/team/project'): RuntimeOverview {
  return {
    profile: {
      id,
      name: id,
      connection: { address: `http://${id}.lan:8787`, token: 'pairing-token' },
    },
    connected: id !== 'origin',
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
        repositories: [
          {
            id: 'repo',
            name: 'Project',
            path: '/repo',
            branch: 'main',
            pullIdentity: identity,
            gitIdentity: 'github.com/clone/origin',
            forge: { connectionId: 'account', repository: 'team/project' },
          },
        ],
        jiraSources: [{ id: 'jira', site: 'https://team.atlassian.net', project: 'TEAM' }],
        agents: [],
        automations: [],
        tasks: [],
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

it('prefers the originating source even offline and offers choices for unscoped ambiguity', () => {
  const sources = [overview('origin'), overview('global')]
  const choices = appLinkChoices('https://github.com/team/project/pull/7/files#diff-1', sources, {
    runtimeId: 'origin',
    repositoryId: 'repo',
  })
  expect(choices).toHaveLength(1)
  expect(choices[0].href.params).toMatchObject({
    runtimeId: 'origin',
    repositoryId: 'repo',
    number: '7',
    tab: 'changes',
    fragment: '#diff-1',
  })
  expect(appLinkChoices('https://github.com/team/project/pull/7', sources)).toHaveLength(2)
})

it('does not borrow a clone origin when the project has an authoritative forge binding', () => {
  const choices = appLinkChoices('https://github.com/clone/origin/pull/7', [overview('origin')], {
    runtimeId: 'origin',
    repositoryId: 'repo',
  })
  expect(choices[0]?.href.params).toMatchObject({
    repositoryId: 'https://github.com/clone/origin/pull/7',
  })
})

it('matches configured Enterprise, Forgejo and nested GitLab PR links by instance and repository', () => {
  for (const [identity, url] of [
    ['ghe.local/team/project', 'https://ghe.local/team/project/pull/7/checks'],
    ['forge.local/team/project', 'http://forge.local/team/project/pulls/7/files'],
    [
      'gitlab.local/group/subgroup/project',
      'http://gitlab.local/group/subgroup/project/-/merge_requests/7/diffs',
    ],
  ]) {
    const choices = appLinkChoices(url, [overview('origin', identity)], { runtimeId: 'origin' })
    expect(choices).toHaveLength(1)
    expect(choices[0].href.params).toMatchObject({ repositoryId: 'repo' })
  }
  expect(
    appLinkChoices('https://ghe-lookalike.local/team/project/pull/7', [
      overview('origin', 'ghe.local/team/project'),
    ]),
  ).toEqual([])
})

it('routes issue, pipeline and Jira URLs with the original owner and rejects other Jira sites/projects', () => {
  const sources = [overview('origin'), overview('global')]
  const origin = { runtimeId: 'origin', repositoryId: 'repo' }
  for (const url of [
    'https://github.com/team/project/issues/7',
    'https://github.com/team/project/actions/runs/7',
    'https://team.atlassian.net/browse/TEAM-7',
  ]) {
    expect(appLinkChoices(url, sources, origin)[0]?.href.params.runtimeId).toBe('origin')
  }
  expect(appLinkChoices('https://other.atlassian.net/browse/TEAM-7', sources, origin)).toEqual([])
  expect(appLinkChoices('https://team.atlassian.net/browse/OTHER-7', sources, origin)).toEqual([])
  expect(
    appLinkChoices('https://github.com.evil.local/team/project/issues/7', sources, origin),
  ).toEqual([])
})
