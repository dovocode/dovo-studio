import {
  AccountClient,
  SharingClient,
  decode,
  shareWriteSchema,
  newSharingKey,
  sharingUUID,
  encryptSuggestion,
  sharingReaderKeys,
  type AccountState,
  type AccountStorage,
  type ShareRecord,
  type SharedContent,
  type PeopleDirectory,
  type PeopleAction,
} from '@dovo/protocol'

/** Synthetic, in-memory adapter for the production sharing manager. Never contacts a service. */
export function createSharingFixture({
  kind = 'thread',
  withKey = true,
}: { kind?: 'thread' | 'artifact'; withKey?: boolean } = {}) {
  let key: string | null = withKey ? newSharingKey() : null
  const storage: AccountStorage = {
    read: async () => null,
    write: async () => {
      throw new Error('Catalog account sign-in is unavailable')
    },
    readSharingKey: async () => key,
    writeSharingKey: async (next) => {
      key = next
    },
  }
  const records = new Map<string, ShareRecord>()
  let fail = false
  const sourceId = 'catalog-computer:catalog-thread',
    origin = 'https://share.example.invalid'
  const content: SharedContent =
    kind === 'artifact'
      ? {
          kind: 'artifact',
          artifact: {
            sourceId: 'f6ce1ce1-f4c3-4000-8000-000000000001',
            revision: 3,
            title: 'Checkout notes',
            format: 'markdown',
            content: '# Checkout notes\nInspect the payment timeout.',
          },
        }
      : {
          kind: 'thread' as const,
          title: 'Investigate the checkout flow',
          messages: [
            {
              id: 'catalog-prompt',
              role: 'user' as const,
              text: 'Can we investigate why checkout stalls on mobile?',
            },
            {
              id: 'catalog-answer',
              role: 'assistant' as const,
              text: 'The payment request is waiting for a response. I will trace its timeout and retry behavior.',
            },
          ],
        }
  class LocalSharing extends SharingClient {
    override async request(
      _origin: string,
      path: string,
      method = 'GET',
      body?: unknown,
    ): Promise<unknown> {
      if (fail) throw new Error('Simulated connection failure. Your published copy is unchanged.')
      if (path === '/v2/shares')
        return {
          shares: [...records.values()].map(
            ({ id, source, kind, version, updatedAt, ownerBox }) => ({
              id,
              source,
              kind,
              version,
              updatedAt,
              ownerBox,
            }),
          ),
        }
      const parts = path.split('/'),
        id = parts[3] ?? ''
      if (parts[4] === 'suggestions') {
        if (method === 'DELETE') {
          suggestions = []
          return { ok: true }
        }
        return { suggestions }
      }
      if (method === 'PUT') {
        const input = decode(shareWriteSchema, body)
        if ((records.get(id)?.version ?? 0) !== input.expectedVersion)
          throw new Error('Sharing changed. Refresh and try again.')
        const next = { ...input.record, version: input.expectedVersion + 1, updatedAt: Date.now() }
        records.set(id, next)
        return next
      }
      if (method === 'DELETE') {
        records.delete(id)
        return { ok: true }
      }
      const record = records.get(id)
      if (!record) throw new Error('Shared copy unavailable')
      return record
    }
  }
  let suggestions: ReturnType<typeof encryptSuggestion>[] = []
  let people: PeopleDirectory = {
    friends: [
      { id: 'catalog-recipient', name: 'Alex', status: 'accepted' },
      { id: 'second-recipient', name: 'Sam', status: 'accepted' },
      { id: 'new-friend', name: 'Jamie', status: 'incoming' },
    ],
    organizations: [
      {
        id: 'd3d97ead-0292-448d-bdf8-1260fd675d10',
        name: 'Dovo team',
        ownerId: 'catalog-owner',
        status: 'member',
        members: [
          { id: 'catalog-owner', name: 'Preview owner', status: 'member' },
          { id: 'catalog-recipient', name: 'Alex', status: 'member' },
        ],
      },
    ],
  }
  class LocalAccount extends AccountClient {
    override people = async () => structuredClone(people)
    override updatePeople = async (input: PeopleAction) => {
      if (fail) throw new Error('Simulated connection failure. Try again.')
      switch (input.action) {
        case 'requestFriend':
          people.friends.push({ id: input.userId, name: input.userId, status: 'outgoing' })
          break
        case 'acceptFriend':
          people.friends = people.friends.map((person) =>
            person.id === input.userId ? { ...person, status: 'accepted' } : person,
          )
          break
        case 'removeFriend':
          people.friends = people.friends.filter((person) => person.id !== input.userId)
          break
        case 'createOrganization':
          people.organizations.push({
            id: sharingUUID(),
            name: input.name,
            ownerId: 'catalog-owner',
            status: 'member',
            members: [{ id: 'catalog-owner', name: 'Preview owner', status: 'member' }],
          })
          break
        case 'deleteOrganization':
          people.organizations = people.organizations.filter(
            (org) => org.id !== input.organizationId,
          )
          break
        case 'acceptOrganization':
          people.organizations = people.organizations.map((org) =>
            org.id === input.organizationId ? { ...org, status: 'member' } : org,
          )
          break
        case 'inviteMember':
          people.organizations
            .find((org) => org.id === input.organizationId)
            ?.members.push({
              id: input.userId,
              name:
                people.friends.find((person) => person.id === input.userId)?.name ?? input.userId,
              status: 'invited',
            })
          break
        case 'removeMember':
          people.organizations = people.organizations.map((org) =>
            org.id === input.organizationId
              ? { ...org, members: org.members.filter((member) => member.id !== input.userId) }
              : org,
          )
          break
      }
      return structuredClone(people)
    }
    override readonly sharing = new LocalSharing(
      storage,
      'https://connect.example.invalid',
      () => ({ userId: 'catalog-owner', sessionId: 'catalog-session' }),
      async () => {
        throw new Error('Network access is disabled in the catalog')
      },
    )
    override sharingService = async () => origin
    override sessionId = () => 'catalog-session'
    override snapshot = (): AccountState => ({
      loaded: true,
      directory: { user: { id: 'catalog-owner', name: 'Preview owner' }, servers: [] },
      login: null,
      busy: false,
      error: '',
      deletionPending: false,
      publications: [],
      publicationError: '',
      publicationOrigin: '',
    })
  }
  const client = new LocalAccount(storage, async () => {}, 'https://connect.example.invalid')
  let enabled = false
  const runtime = {
    taskId: 'catalog-thread',
    preview: async () => content,
    enable: async () => {
      enabled = true
      return { enabled, error: '' }
    },
    stop: async () => {
      enabled = false
      return { enabled, error: '' }
    },
    status: async () => ({ enabled, error: '' }),
  }
  const ready = async (published = true) => {
    if (!published) return
    let share = await client.sharing.publish(origin, sourceId, content)
    share = await client.sharing.invite(origin, share, 'catalog-recipient')
    share = await client.sharing.invite(origin, share, undefined, 604800)
    suggestions =
      kind === 'thread'
        ? [
            encryptSuggestion(
              {
                shareId: share.record.id,
                revision: share.record.packet.revision,
                name: 'Alex',
                text: 'Could we check whether the request is cancelled when the app goes into the background?',
              },
              sharingReaderKeys(share.vault).suggestionKey,
            ),
          ]
        : []
    if (kind !== 'thread') return
    const resumed = await client.sharing.setPaused(origin, share, false)
    enabled = true
    // Keep fixture identity and permissions local; these values never authorize a real service.
    records.set(resumed.share.record.id, resumed.share.record)
  }
  return {
    client,
    runtime,
    sourceId,
    content,
    ready,
    fail: (value: boolean) => {
      fail = value
    },
    records,
    forgetKey: () => {
      key = null
    },
  }
}
