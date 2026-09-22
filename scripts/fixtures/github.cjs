#!/usr/bin/env node
// Isolated desktop verification fixture. No requests are sent to GitHub.
const { basename } = require('node:path')
const { existsSync, readFileSync, writeFileSync, appendFileSync } = require('node:fs')
const name = basename(process.cwd())
const args = process.argv.slice(2)
const longText = process.env.DOVO_TEST_LONG_PULLS === '1'
const richText = process.env.DOVO_TEST_RICH_PULLS === '1'
const manyPulls = process.env.DOVO_TEST_MANY_PULLS === '1'
const filePath = longText
  ? 'packages/runtime/src/connections/remote-device-reconnection-and-recovery.ts'
  : 'src/runtime.ts'
if (!['first', 'second'].includes(name) && args[0] !== 'auth') {
  console.error('Fixture repository has no GitHub remote')
  process.exit(1)
}
const url = `https://github.com/test/${name}`
const createdPath = '.git/dovo-created-pull.json'
const resolvedPath = '.git/dovo-resolved-thread.json'
const created = existsSync(createdPath) ? JSON.parse(readFileSync(createdPath, 'utf8')) : null
const resolved = existsSync(resolvedPath) ? JSON.parse(readFileSync(resolvedPath, 'utf8')) : false
const field = (name) => args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1)
const writeAction = () => appendFileSync('.git/dovo-actions.jsonl', JSON.stringify(args) + '\n')
const pull = {
  number: 7,
  title: `Fix ${name} runtime`,
  html_url: `${url}/pull/7`,
  state: 'open',
  merged_at: null,
  draft: false,
  user: { login: 'dominic' },
  updated_at: '2026-09-07T10:00:00Z',
  head: {
    label: longText
      ? 'test:fix/restore-remote-runtime-connections-after-network-changes'
      : 'test:fix',
    sha: 'a'.repeat(40),
  },
  base: { label: 'test:main', sha: 'b'.repeat(40) },
  labels: [{ name: 'bug' }],
  body: richText
    ? [
        '## Runtime fix',
        'A real description shape from the test fixture. **Reconnect safely** and preserve `taskId`.',
        'Run `pnpm test --filter mobile`, then review `apps/mobile/src/tasks/conversation-provider.tsx`.',
        '### Validation checklist',
        '- [x] Keep the current conversation\n- [ ] Confirm recovery after a network change',
        '> Reviewers can keep their approval while adding a follow-up comment.',
        '### Example',
        '```typescript\nconst connection = await connectRuntime({\n  address: "https://developer-runtime.example.com",\n  reconnect: true,\n})\n```',
        '### Verification matrix',
        '| Surface | Result | Scenario |\n| --- | --- | --- |\n| iPhone | Passed | Remote runtime reconnects after the connection changes from Wi-Fi to the mobile network |\n| Desktop | Passed | The draft remains available |',
        'See [setup instructions](docs/setup.md) and [the checklist](#validation-checklist).',
      ].join('\n\n')
    : '## Runtime fix\nA real description shape from the test fixture.',
  additions: 2,
  deletions: 1,
  changed_files: 1,
  mergeable: true,
  requested_reviewers: [{ login: 'reviewer' }],
  assignees: [],
}
const comment = {
  id: 1,
  user: { login: 'reviewer' },
  body: 'Please verify cancellation.',
  html_url: `${url}/pull/7#issuecomment-1`,
  created_at: '2026-09-07T11:00:00Z',
}
const extraPulls =
  manyPulls && name === 'first'
    ? Array.from({ length: 20 }, (_, index) => ({
        ...pull,
        number: 100 + index,
        title:
          index === 19 ? 'Final navigation pull request' : `Navigation pull request ${index + 1}`,
        html_url: `${url}/pull/${100 + index}`,
        updated_at: new Date(Date.UTC(2026, 8, 6, 12, 0, -index)).toISOString(),
        body: '## Navigation return proof\n\nReturn to the same place in the pull request list.',
      }))
    : []
let value
if (args[0] === 'auth')
  value = { hosts: { 'github.com': [{ login: 'reviewer', active: true, state: 'success' }] } }
else if (args[0] === 'repo') value = { nameWithOwner: `test/${name}`, url }
else if (args.includes('graphql') && field('query')?.includes('reviewThreads('))
  value = {
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            nodes: [
              {
                id: 'thread-4',
                isResolved: resolved,
                isOutdated: false,
                viewerCanResolve: true,
                viewerCanUnresolve: true,
                comments: {
                  nodes: [{ databaseId: 4 }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    },
  }
else if (args.includes('graphql') && field('query')?.includes('node(id:'))
  value = {
    data: {
      node: {
        __typename: 'PullRequestReviewThread',
        isResolved: resolved,
        viewerCanResolve: true,
        viewerCanUnresolve: true,
        pullRequest: { number: 7, repository: { nameWithOwner: `test/${name}` } },
      },
    },
  }
else if (args.includes('graphql') && field('query')?.startsWith('mutation')) {
  const operation = field('query').includes('unresolveReviewThread')
    ? 'unresolveReviewThread'
    : 'resolveReviewThread'
  writeAction()
  writeFileSync(resolvedPath, JSON.stringify(operation === 'resolveReviewThread'))
  value = {
    data: {
      [operation]: { thread: { id: 'thread-4', isResolved: operation === 'resolveReviewThread' } },
    },
  }
} else if (
  args.includes('POST') ||
  args.includes('PUT') ||
  args.includes('PATCH') ||
  args.includes('DELETE')
) {
  writeAction()
  const endpoint = args[3]
  if (endpoint === `repos/test/${name}/pulls` && args.includes('POST')) {
    value = {
      ...pull,
      number: 8,
      title: field('title'),
      body: field('body'),
      html_url: `${url}/pull/8`,
      draft: field('draft') === 'true',
      head: { ...pull.head, label: `test:${field('head')}` },
      base: { ...pull.base, label: `test:${field('base')}` },
    }
    writeFileSync(createdPath, JSON.stringify(value))
  } else if (endpoint.endsWith('/merge')) {
    if (created && endpoint.includes('/pulls/8/'))
      writeFileSync(
        createdPath,
        JSON.stringify({ ...created, state: 'closed', merged_at: '2026-09-20T08:00:00Z' }),
      )
    value = { merged: true, message: 'Pull request successfully merged.' }
  } else if (created && endpoint.endsWith('/pulls/8') && args.includes('PATCH')) {
    value = {
      ...created,
      ...(field('title') ? { title: field('title'), body: field('body') } : {}),
      ...(field('state') ? { state: field('state') } : {}),
    }
    writeFileSync(createdPath, JSON.stringify(value))
  } else value = { html_url: url + '/pull/7#new-comment' }
} else if (args.includes('graphql'))
  value = {
    data: {
      viewer: { login: 'reviewer' },
      repository: Object.fromEntries(
        [pull, ...extraPulls, ...(created ? [created] : [])].map((entry) => [
          `pr${entry.number}`,
          {
            viewerDidAuthor: false,
            reviewRequests: {
              nodes: name === 'second' ? [{ requestedReviewer: { login: 'reviewer' } }] : [],
              pageInfo: { hasNextPage: false },
            },
            reviewDecision: name === 'second' ? 'CHANGES_REQUESTED' : 'APPROVED',
            statusCheckRollup: { state: name === 'second' ? 'FAILURE' : 'SUCCESS' },
          },
        ]),
      ),
    },
  }
else if (args[0] === 'pr')
  value = {
    statusCheckRollup: [
      {
        name: 'Typecheck',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        detailsUrl: `${url}/actions/runs/1`,
      },
      ...(longText
        ? [
            {
              name: 'Verify remote runtime reconnection across Tailscale and NetBird devices',
              status: 'COMPLETED',
              conclusion: 'SUCCESS',
              detailsUrl: `${url}/actions/runs/2`,
            },
          ]
        : []),
    ],
  }
else if (args[0] === 'api') {
  const endpoint = args[3]
  if (endpoint === `repos/test/${name}`)
    value = {
      id: 1,
      name,
      full_name: `test/${name}`,
      html_url: url,
      clone_url: `${url}.git`,
      default_branch: 'main',
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true,
    }
  else if (endpoint.includes('/check-runs?'))
    value = [
      {
        check_runs: [
          {
            id: 10,
            name: 'Typecheck',
            status: 'completed',
            conclusion: 'success',
            details_url: `${url}/actions/runs/1`,
            output: {
              summary: richText ? 'Verified **types** and `taskId` stability.' : null,
              text: richText
                ? '### Check output\n\nRun `pnpm typecheck` to reproduce locally.'
                : null,
              annotations_count: richText ? 1 : 0,
            },
          },
        ],
      },
    ]
  else if (endpoint.includes('/check-runs/10/annotations'))
    value = [
      [
        {
          path: 'src/runtime.ts',
          start_line: 12,
          end_line: 12,
          annotation_level: 'notice',
          message: 'Cancellation path verified.',
          title: 'Runtime check',
        },
      ],
    ]
  else if (endpoint.endsWith('/pulls/comments/4'))
    value = { id: 4, pull_request_url: `https://api.github.com/repos/test/${name}/pulls/7` }
  else if (created && endpoint.endsWith('/pulls/8')) value = created
  else if (endpoint.includes('/pulls?'))
    value = [
      {
        ...pull,
        ...(endpoint.includes('state=closed')
          ? { state: 'closed', merged_at: '2026-09-07T12:00:00Z' }
          : {}),
      },
      ...extraPulls,
      ...(created && (endpoint.includes('state=all') || endpoint.includes('state=' + created.state))
        ? [created]
        : []),
    ]
  else if (endpoint.endsWith('/pulls/7')) value = pull
  else if (extraPulls.some((entry) => endpoint.endsWith(`/pulls/${entry.number}`)))
    value = extraPulls.find((entry) => endpoint.endsWith(`/pulls/${entry.number}`))
  else if (endpoint.includes('/issues/'))
    value = [[comment], [{ ...comment, id: 2, body: 'Verified second comment page.' }]]
  else if (endpoint.includes('/reviews?'))
    value = [
      [
        {
          ...comment,
          id: 3,
          body: richText ? '' : 'Looks good.',
          state: 'APPROVED',
          submitted_at: comment.created_at,
        },
        ...(richText
          ? [
              {
                ...comment,
                id: 5,
                body: 'Added context without changing my approval. Keep `taskId` stable. Run `pnpm test`; check `src/runtime.ts` before merging.',
                state: 'COMMENTED',
                submitted_at: '2026-09-07T11:05:00Z',
              },
              {
                ...comment,
                id: 6,
                user: { login: 'security-reviewer' },
                body: '### One change requested\n\n- [ ] Preserve the pending response when reconnecting.\n\nPlease cover **cancellation** in the regression test.',
                state: 'CHANGES_REQUESTED',
                submitted_at: '2026-09-07T11:10:00Z',
              },
            ]
          : []),
      ],
    ]
  else if (endpoint.includes('/comments?'))
    value = [
      [
        {
          ...comment,
          id: 4,
          body: 'Inline cancellation feedback',
          path: filePath,
          line: 12,
          original_line: 12,
          diff_hunk: '@@ -255,12 +255,14 @@\n-old\n+new',
        },
      ],
    ]
  else if (endpoint.includes('/files?'))
    value = [
      [
        {
          filename: filePath,
          status: 'modified',
          additions: 2,
          deletions: 1,
          patch: '@@ -1 +1,2 @@\n-old\n+new\n+tail',
        },
      ],
    ]
}
if (!value) {
  console.error('Unexpected fixture command')
  process.exit(1)
}
process.stdout.write(JSON.stringify(value))
