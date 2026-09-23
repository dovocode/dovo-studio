import { expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { JiraWork, jiraMarkdown, listJiraProjects } from './jira'
import type { runForgeCli } from './forge-cli'
const auth =
  '✓ Authenticated\n  Site: team.atlassian.net\n  Email: user@example.com\n  Authentication Type: oauth'
const binding = {
  site: 'https://team.atlassian.net',
  project: 'TEAM',
}
const project = {
  key: 'TEAM',
  self: 'https://team.atlassian.net/rest/api/3/project/1',
  issueTypes: [
    {
      name: 'Task',
    },
  ],
}
const raw = {
  id: '100',
  key: 'TEAM-1',
  self: 'https://team.atlassian.net/rest/api/3/issue/100',
  fields: {
    summary: 'Task',
    description: {
      version: 1,
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Hello',
              marks: [
                {
                  type: 'strong',
                },
              ],
            },
            {
              type: 'text',
              text: ' world',
            },
          ],
        },
      ],
    },
    status: {
      name: 'To Do',
    },
    issuetype: {
      name: 'Task',
    },
    labels: [],
    updated: '2026-09-20T10:00:00Z',
  },
}
it('renders ADF text and marks as Markdown with schema validation', () => {
  expect(jiraMarkdown(raw.fields.description)).toContain('**Hello**')
  expect(() =>
    jiraMarkdown({
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'text',
        },
      ],
    }),
  ).toThrow('invalid rich-text')
})
it('checks the active CLI site before a write instead of switching accounts', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValue(auth.replace('team.atlassian.net', 'other.atlassian.net'))
  await expect(
    new JiraWork('acli', binding, run).createIssue({
      title: 'test',
      body: 'body',
      type: 'Task',
      assignees: [],
      labels: [],
    }),
  ).rejects.toThrow('another Jira site')
  expect(run).toHaveBeenCalledTimes(1)
})
it('keeps Jira independent of any repository provider and paginates with scoped JQL', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(
      JSON.stringify(
        Array.from(
          {
            length: 31,
          },
          (_, i) => ({
            ...raw,
            key: `TEAM-${100 - i}`,
          }),
        ),
      ),
    )
  const page = await new JiraWork('acli', binding, run).issues('all')
  expect(page.items).toHaveLength(30)
  expect(page.next).toBe('30')
  expect(run.mock.calls[2]?.[1]).toContain('project = TEAM ORDER BY updated DESC, key DESC')
})
it('preserves original ADF for an unchanged description', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(JSON.stringify(raw))
    .mockResolvedValueOnce('{}')
  await new JiraWork('acli', binding, run).actOnIssue({
    action: 'edit',
    id: 'TEAM-1',
    revision: raw.fields.updated,
    title: 'New title',
    body: jiraMarkdown(raw.fields.description),
  })
  expect(run.mock.calls[3]?.[1]).not.toContain('--description-file')
  expect(run.mock.calls[3]?.[1]).toContain('New title')
})
it('does not invoke a CLI mutation when an edit contains no changed fields', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(JSON.stringify(raw))
  const result = await new JiraWork('acli', binding, run).actOnIssue({
    action: 'edit',
    id: raw.key,
    revision: raw.fields.updated,
  })
  expect(result.message).toBe('No changes to save')
  expect(run).toHaveBeenCalledTimes(3)
  expect(run.mock.calls.some(([, args]) => args.includes('edit'))).toBe(false)
})
it('distinguishes partial Jira discussion from a failed refresh', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(
      JSON.stringify({
        ...raw,
        fields: {
          ...raw.fields,
          comment: {
            total: 4,
            comments: [],
          },
        },
      }),
    )
  const detail = await new JiraWork('acli', binding, run).issue(raw.key)
  expect(detail.discussionNotice).toContain('More comments are available in Jira')
  expect(detail).not.toHaveProperty('refreshError')
})
it('writes comments through a private temporary file and never places the body in argv', async () => {
  let file = ''
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(JSON.stringify(raw))
    .mockImplementationOnce(async (_cmd, args) => {
      file = args[args.indexOf('--body-file') + 1]!
      expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({
        version: 1,
        type: 'doc',
      })
      expect(args.join(' ')).not.toContain('private comment')
      return '{}'
    })
  await new JiraWork('acli', binding, run).actOnIssue({
    action: 'comment',
    id: 'TEAM-1',
    revision: raw.fields.updated,
    body: 'private comment',
  })
  await expect(readFile(file)).rejects.toThrow('ENOENT')
})
it('rejects stale Jira edits before issuing a mutation', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(JSON.stringify(raw))
  await expect(
    new JiraWork('acli', binding, run).actOnIssue({
      action: 'edit',
      id: 'TEAM-1',
      revision: 'old',
      title: 'new',
    }),
  ).rejects.toThrow('changed')
  expect(run).toHaveBeenCalledTimes(3)
})
it('transitions Jira status as a single explicit CLI operation', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(JSON.stringify(raw))
    .mockResolvedValueOnce('{}')
  await new JiraWork('acli', binding, run).actOnIssue({
    action: 'edit',
    id: 'TEAM-1',
    revision: raw.fields.updated,
    state: 'In Progress',
  })
  expect(run).toHaveBeenLastCalledWith(
    'acli',
    [
      'jira',
      'workitem',
      'transition',
      '--key',
      'TEAM-1',
      '--status',
      'In Progress',
      '--yes',
      '--json',
    ],
    undefined,
    undefined,
  )
})
it('runs Jira identity, reads and mutations from the selected project checkout', async () => {
  const cwd = '/projects/selected-checkout'
  const run = vi
    .fn<typeof runForgeCli>()
    .mockImplementation(async (_executable, args, _input, directory) => {
      expect(directory).toBe(cwd)
      if (args.includes('project')) return JSON.stringify(project)
      if (args.includes('auth')) return auth
      if (args.includes('view')) return JSON.stringify(raw)
      return '{}'
    })
  const jira = new JiraWork('acli', binding, run, cwd)
  await jira.identity()
  await jira.actOnIssue({
    action: 'edit',
    id: raw.key,
    revision: raw.fields.updated,
    title: 'Updated',
  })
  expect(run).toHaveBeenCalledTimes(4)
  expect(run.mock.calls.every(([, args]) => !args.includes('switch'))).toBe(true)
})
it('refuses a combined Jira edit and transition instead of partially applying it', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(JSON.stringify(raw))
  await expect(
    new JiraWork('acli', binding, run).actOnIssue({
      action: 'edit',
      id: 'TEAM-1',
      revision: raw.fields.updated,
      title: 'Changed',
      state: 'Done',
    }),
  ).rejects.toThrow('separately')
  expect(run).toHaveBeenCalledTimes(3)
})
it('accepts OAuth gateway self links while checking the authenticated site', async () => {
  const gateway = 'https://jira-prod-eu-13-3.prod.atl-paas.net/rest/api/3'
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(
      JSON.stringify({
        ...project,
        self: `${gateway}/project/1`,
        issueTypes: null,
      }),
    )
    .mockResolvedValueOnce(
      JSON.stringify({
        ...raw,
        self: `${gateway}/issue/100`,
      }),
    )
  const jira = new JiraWork('acli', binding, run)
  expect((await jira.options()).issueTypes).toEqual([])
  const detail = await jira.issue(raw.key)
  expect(detail.issue.url).toBe('https://team.atlassian.net/browse/TEAM-1')
  expect(run).toHaveBeenCalledTimes(3)
})
it('discovers projects from the signed-in checkout without exposing account details', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(
      JSON.stringify([
        {
          key: 'TEAM',
          name: 'Developer Experience',
        },
      ]),
    )
  expect(await listJiraProjects('acli-custom', '/checkout', run)).toEqual({
    site: 'https://team.atlassian.net',
    projects: [
      {
        key: 'TEAM',
        name: 'Developer Experience',
      },
    ],
    truncated: false,
  })
  expect(
    run.mock.calls.every(([cmd, , , cwd]) => cmd === 'acli-custom' && cwd === '/checkout'),
  ).toBe(true)
  expect(run.mock.calls[1]?.[1]).toEqual(['jira', 'project', 'list', '--limit', '201', '--json'])
})
it('rejects an unidentifiable account before reading projects', async () => {
  const run = vi.fn<typeof runForgeCli>().mockResolvedValue('not authenticated')
  await expect(listJiraProjects('acli', '/checkout', run)).rejects.toThrow('acli jira auth login')
  expect(run).toHaveBeenCalledTimes(1)
})
it('reads supported search fields without inventing a date or revision', async () => {
  const { updated: _updated, ...fields } = raw.fields
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(
      JSON.stringify([
        {
          ...raw,
          fields,
        },
      ]),
    )
  const page = await new JiraWork('acli', binding, run).issues('open')
  expect(page.items[0]).toMatchObject({
    updatedAt: '',
    revision: '',
  })
  const args = run.mock.calls[2]![1]
  expect(args[args.indexOf('--fields') + 1]).toBe(
    'key,summary,description,status,issuetype,creator,assignee,labels',
  )
  expect(args).toContain(
    'project = TEAM AND statusCategory != Done ORDER BY updated DESC, key DESC',
  )
})
it('paginates recently updated issues and searches by key with project scope intact', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(
      JSON.stringify(
        Array.from(
          {
            length: 61,
          },
          (_, i) => ({
            ...raw,
            key: `TEAM-${100 - i}`,
          }),
        ),
      ),
    )
  const page = await new JiraWork('acli', binding, run).issues('closed', '30', 'team-40')
  expect(page.items).toHaveLength(30)
  expect(page.items[0]?.id).toBe('TEAM-70')
  expect(page.next).toBe('60')
  const args = run.mock.calls[2]![1]
  expect(args[args.indexOf('--limit') + 1]).toBe('61')
  expect(args).toContain(
    'project = TEAM AND statusCategory = Done AND key = "TEAM-40" ORDER BY updated DESC, key DESC',
  )
})
it('keeps exact custom states and escapes search text as a JQL literal', async () => {
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce('[]')
  await new JiraWork('acli', binding, run).issues(
    'Waiting for review',
    undefined,
    'deploy "OR" project = OTHER',
  )
  const args = run.mock.calls[2]![1]
  const jql = args[args.indexOf('--jql') + 1]!
  expect(jql).toContain('AND status = "Waiting for review" AND text ~ ')
  expect(JSON.parse(jql.split(' AND text ~ ')[1]!.split(' ORDER BY')[0]!)).toBe(
    '"deploy \\"OR\\" project = OTHER"',
  )
})
it('keeps readable content and a notice when one ADF extension is unsupported', async () => {
  const description = {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'Ship the fix: ',
          },
          {
            type: 'status',
            attrs: {
              text: 'IN REVIEW',
              color: 'blue',
              localId: 'status-1',
            },
          },
        ],
      },
    ],
  }
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(
      JSON.stringify({
        ...raw,
        fields: {
          ...raw.fields,
          description,
          assignee: {
            displayName: 'Sam Developer',
            accountId: '712:opaque-account',
          },
          comment: {
            total: 1,
            comments: [
              {
                id: '1',
                body: description,
                author: null,
                created: raw.fields.updated,
              },
            ],
          },
        },
      }),
    )
  const detail = await new JiraWork('acli', binding, run).issue(raw.key)
  expect(detail.issue).toMatchObject({
    body: 'Ship the fix: IN REVIEW',
    bodyNotice: expect.stringContaining('rich content'),
    assignees: ['712:opaque-account'],
    assigneeNames: ['Sam Developer'],
  })
  expect(detail.comments[0]).toMatchObject({
    author: 'Deleted user',
    body: expect.stringContaining('IN REVIEW'),
  })
})
it('requires a real detail revision before any write', async () => {
  const { updated: _updated, ...fields } = raw.fields
  const run = vi
    .fn<typeof runForgeCli>()
    .mockResolvedValueOnce(auth)
    .mockResolvedValueOnce(JSON.stringify(project))
    .mockResolvedValueOnce(
      JSON.stringify({
        ...raw,
        fields,
      }),
    )
  await expect(
    new JiraWork('acli', binding, run).actOnIssue({
      action: 'edit',
      id: raw.key,
      revision: 'old',
      title: 'Changed',
    }),
  ).rejects.toThrow('revision')
  expect(run).toHaveBeenCalledTimes(3)
})
