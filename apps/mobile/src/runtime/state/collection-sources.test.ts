import { decode } from '@dovo/protocol'
import { expect, it } from 'vite-plus/test'
import {
  repositorySchema,
  runtimeProfile,
  snapshotSchema,
  type RuntimeOverview,
} from '@dovo/protocol'
import {
  collectionSources,
  collectionSourceIdentity,
  projectSourceKey,
  retainProjectPages,
} from './collection-sources'
const repository = decode(repositorySchema, {
  id: 'shared-project',
  name: 'App',
  path: '/projects/app',
  branch: 'main',
})
function overview(host: string, connected = true): RuntimeOverview {
  return {
    profile: runtimeProfile(
      {
        address: `http://${host}:51464`,
        token: `${host}-device-credential`,
      },
      host,
    ),
    snapshot: decode(snapshotSchema, {
      revision: 1,
      owner: false,
      workspace: {
        version: 1,
        runtimeAddress: '',
        agents: [],
        automations: [],
        tasks: [],
        repositories: [repository],
      },
      approvals: [],
      questions: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    }),
    connected,
    lastSeen: '2026-09-20T10:00:00Z',
    error: null,
    pulls: null,
    pullError: null,
  }
}
it('labels sources with the computer name without changing saved connection names or content ownership', () => {
  const entry = overview('vpn.example.com', false)
  const withName = { ...entry, snapshot: { ...entry.snapshot!, runtimeHost: 'My workstation' } }
  const original = collectionSources([entry])[0]
  const source = collectionSources([withName])[0]
  expect(source.computerName).toBe('My workstation')
  expect(source.profile.name).toBe('vpn.example.com')
  expect(source.profile).toBe(entry.profile)
  expect(retainProjectPages([{ source: original, items: ['cached'] }], [source])).toEqual([
    { source, items: ['cached'] },
  ])
  expect(collectionSourceIdentity([source])).not.toBe(collectionSourceIdentity([original]))
})
it('keeps identical project IDs separate across computers, including saved offline work', () => {
  const first = overview('laptop'),
    second = overview('workstation', false)
  const sources = collectionSources([first, second])
  expect(sources).toHaveLength(2)
  expect(new Set(sources.map((source) => source.key)).size).toBe(2)
  expect(sources[1]).toMatchObject({
    connected: false,
    repository: {
      id: 'shared-project',
    },
  })
  expect(sources[1].key).toBe(projectSourceKey(second.profile.id, repository.id))
})
it('does not reload source collections for unrelated live snapshot activity', () => {
  const entry = overview('laptop')
  const before = collectionSourceIdentity(collectionSources([entry]))
  expect(
    collectionSourceIdentity(
      collectionSources([
        {
          ...entry,
          snapshot: {
            ...entry.snapshot!,
            revision: 3,
          },
        },
      ]),
    ),
  ).toBe(before)
})
it('retains other computers and saved rows when a computer goes offline or is renamed', () => {
  const first = overview('laptop'),
    second = overview('workstation')
  const pages = collectionSources([first, second]).map((source) => ({
    source,
    items: [source.profile.name],
  }))
  const after = collectionSources([
    {
      ...first,
      connected: false,
      profile: {
        ...first.profile,
        name: 'Travel laptop',
      },
    },
    second,
  ])
  const retained = retainProjectPages(pages, after)
  expect(retained).toHaveLength(2)
  expect(retained[0]).toMatchObject({
    source: {
      connected: false,
      profile: {
        name: 'Travel laptop',
      },
    },
    items: ['laptop'],
  })
  expect(retained[1].items).toEqual(['workstation'])
})
it('immediately removes forgotten or reauthenticated sources without removing another computer', () => {
  const first = overview('laptop'),
    second = overview('workstation')
  const pages = collectionSources([first, second]).map((source) => ({
    source,
    items: ['sensitive PR'],
  }))
  expect(
    retainProjectPages(pages, collectionSources([second])).map((page) => page.source.profile.name),
  ).toEqual(['workstation'])
  const replaced = {
    ...first,
    profile: {
      ...first.profile,
      connection: {
        ...first.profile.connection,
        token: 'replacement-credential',
      },
    },
  }
  expect(
    retainProjectPages(pages, collectionSources([replaced, second])).map(
      (page) => page.source.profile.name,
    ),
  ).toEqual(['workstation'])
})
it('drops rows when a checkout changes its provider or path while keeping its ID', () => {
  const source = collectionSources([overview('laptop')])[0]
  const pages = [
    {
      source,
      items: ['old source'],
    },
  ]
  expect(
    retainProjectPages(pages, [
      {
        ...source,
        repository: {
          ...source.repository,
          path: '/different/app',
        },
      },
    ]),
  ).toEqual([])
  expect(
    retainProjectPages(pages, [
      {
        ...source,
        repository: {
          ...source.repository,
          forge: {
            connectionId: 'new-account',
            repository: 'org/app',
          },
        },
      },
    ]),
  ).toEqual([])
})
