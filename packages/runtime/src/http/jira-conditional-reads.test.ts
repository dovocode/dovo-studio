import { afterEach, expect, it, vi } from 'vite-plus/test'
import {
  conditionalReadSchema,
  decode,
  forgeIssueDetailSchema,
  forgeSourceIdentitySchema,
  forgeWorkOptionsSchema,
  jiraBoardsSchema,
} from '@dovo/protocol'
import * as context from '../scm/forges/providers/jira-context'
import * as cli from '../scm/forges/integration/forge-cli'
import { JiraWork } from '../scm/forges/providers/jira'
import { HttpError } from '../errors'
import { startRuntime } from '../index'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function setup() {
  let email = 'first@example.com'
  let site = 'first.atlassian.net'
  let body = 'Private description ' + 'x'.repeat(64_000)
  let revision = 'v1'
  vi.spyOn(context, 'captureJiraContext').mockResolvedValue({
    env: { ACLI_CONFIG_DIR: '/fixture/pinned' },
    accountId: (_site, email) => email,
    close: async () => {},
  })
  vi.spyOn(cli, 'runForgeCli').mockImplementation(async (_command, args) => {
    if (args.includes('auth'))
      return `Authenticated\nSite: ${site}\nEmail: ${email}\nAuthentication Type: oauth`
    if (args.includes('project'))
      return JSON.stringify({
        key: 'TEAM',
        self: 'https://api.atlassian.com/project/1',
        issueTypes: [],
      })
    throw new Error('Unexpected provider operation')
  })
  const issue = vi
    .spyOn(JiraWork.prototype, 'issue')
    .mockImplementation(async (id, cursor, section) =>
      decode(forgeIssueDetailSchema, {
        issue: {
          id,
          title: 'Private issue',
          body,
          state: 'Open',
          url: 'https://first.atlassian.net/browse/' + id,
          author: 'Dominic',
          assignees: [],
          labels: [],
          updatedAt: revision,
          revision,
        },
        comments:
          section === 'discussion'
            ? [{ id: cursor ?? 'first', body: 'Comment', author: 'Dominic', createdAt: '' }]
            : [],
        next: section === 'discussion' && !cursor ? '30' : undefined,
      }),
    )
  vi.spyOn(JiraWork.prototype, 'boards').mockResolvedValue({
    boards: [{ id: '1', name: 'Delivery', type: 'scrum' }],
    truncated: false,
  })
  const token = 'jira-conditional-test-owner-token-with-32-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanup.push(() => runtime.close())
  runtime.services.store.update((w) => ({
    ...w,
    jiraSources: [
      { id: 'jira', site: 'https://first.atlassian.net', project: 'TEAM', name: 'Team' },
    ],
  }))
  const call = async (operation: string, input: object, bearer = token) => {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/scm/${operation}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    return { status: response.status, data: (await response.json()) as unknown }
  }
  const identity = decode(
    forgeSourceIdentitySchema,
    (await call('source/identity', { jiraSourceId: 'jira' })).data,
  )
  const input = {
    jiraSourceId: 'jira',
    id: 'TEAM-1',
    section: 'overview',
    conditional: true,
    expectedReaderIdentity: identity.readerIdentity,
    expectedDestination: identity.destination,
  }
  return {
    call,
    input,
    issue,
    setBody(value: string) {
      body = value
      revision = 'v2'
    },
    setEmail(value: string) {
      email = value
    },
    setSite(value: string) {
      site = value
    },
  }
}
const detailReply = conditionalReadSchema(forgeIssueDetailSchema)
it('sends compact Jira replies over HTTP, preserves legacy reads and versions changed content', async () => {
  const f = await setup()
  const first = await f.call('work/issues/detail', f.input)
  expect(first.status).toBe(200)
  const full = decode(detailReply, first.data)
  if (!('value' in full)) throw new Error('Initial read requires a full value')
  expect(full.value.issue.body.length).toBeGreaterThan(64_000)
  const repeat = await f.call('work/issues/detail', { ...f.input, knownVersion: full.readVersion })
  expect(repeat).toEqual({ status: 200, data: { unchanged: true, readVersion: full.readVersion } })
  expect(JSON.stringify(repeat.data).length).toBe(99)
  expect(f.issue).toHaveBeenCalledTimes(1)
  const legacy = await f.call('work/issues/detail', {
    jiraSourceId: 'jira',
    id: 'TEAM-1',
    section: 'overview',
  })
  expect(decode(forgeIssueDetailSchema, legacy.data).issue.body).toBe(full.value.issue.body)
  f.setBody('Edited description')
  const changed = decode(
    detailReply,
    (
      await f.call('work/issues/detail', {
        ...f.input,
        refresh: true,
        knownVersion: full.readVersion,
      })
    ).data,
  )
  if (!('value' in changed)) throw new Error('Changed read requires a full value')
  expect(changed.value.issue.body).toBe('Edited description')
  expect(changed.readVersion).not.toBe(full.readVersion)
})
it('keeps discussion pages, action metadata and board versions separate', async () => {
  const f = await setup()
  const full = decode(detailReply, (await f.call('work/issues/detail', f.input)).data)
  if (!('value' in full)) throw new Error('Missing baseline')
  for (const cursor of [undefined, '30']) {
    const page = decode(
      detailReply,
      (
        await f.call('work/issues/detail', {
          ...f.input,
          section: 'discussion',
          cursor,
          knownVersion: full.readVersion,
        })
      ).data,
    )
    expect(page).toHaveProperty('value.comments')
    expect(page).not.toHaveProperty('unchanged')
  }
  for (const [operation, schema] of [
    ['options', conditionalReadSchema(forgeWorkOptionsSchema)],
    ['jira/boards', conditionalReadSchema(jiraBoardsSchema)],
  ] as const) {
    const input = { jiraSourceId: 'jira', conditional: true }
    const first = decode(schema, (await f.call('work/' + operation, input)).data)
    if (!('value' in first)) throw new Error('Missing baseline')
    expect(
      (await f.call('work/' + operation, { ...input, knownVersion: first.readVersion })).data,
    ).toEqual({ unchanged: true, readVersion: first.readVersion })
  }
})
it.each(['account', 'site', 'destination', 'pairing', 'forbidden'] as const)(
  'checks %s before returning an unchanged Jira response',
  async (kind) => {
    const f = await setup()
    const first = decode(detailReply, (await f.call('work/issues/detail', f.input)).data)
    if (!('value' in first)) throw new Error('Missing baseline')
    if (kind === 'account') f.setEmail('other@example.com')
    if (kind === 'site') f.setSite('other.atlassian.net')
    if (kind === 'forbidden') f.issue.mockRejectedValue(new HttpError(403, 'Access denied'))
    const input = {
      ...f.input,
      knownVersion: first.readVersion,
      ...(kind === 'destination' ? { expectedDestination: 'changed' } : {}),
      ...(kind === 'forbidden' ? { refresh: true } : {}),
    }
    const result = await f.call(
      'work/issues/detail',
      input,
      kind === 'pairing' ? 'wrong-device-token' : undefined,
    )
    expect(result.status).toBe(kind === 'pairing' ? 401 : kind === 'forbidden' ? 403 : 409)
    expect(result.data).not.toHaveProperty('unchanged')
    expect(JSON.stringify(result.data)).not.toContain('Private description')
  },
)

it('rejects malformed conditional query fields before provider reads', async () => {
  const f = await setup()
  for (const invalid of [{ conditional: 'true' }, { knownVersion: 'invalid-version' }]) {
    const response = await f.call('work/issues/detail', { ...f.input, ...invalid })
    expect(response.status).toBe(400)
  }
  expect(f.issue).not.toHaveBeenCalled()
})
