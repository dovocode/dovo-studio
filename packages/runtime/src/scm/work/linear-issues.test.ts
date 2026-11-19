import { afterEach, expect, it, vi } from 'vite-plus/test'
import { readLinearIssues } from './linear-issues.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('uses a read-only query for the configured Linear account and preserves pagination', async () => {
  vi.stubEnv('DOVO_LINEAR_API_KEY', 'local-test-key')
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    Response.json({
      data: {
        issues: {
          nodes: [
            {
              id: '1',
              identifier: 'TEAM-11',
              title: 'Fix timer',
              description: null,
              url: 'https://linear.app/team/issue/TEAM-11',
              state: { name: 'In progress' },
            },
            {
              id: '2',
              identifier: 'TEAM-12',
              title: 'Invalid URL',
              description: null,
              url: 'https://example.net/issue',
              state: { name: 'Open' },
            },
          ],
          pageInfo: { hasNextPage: true, endCursor: 'next-cursor' },
        },
      },
    }),
  )
  vi.stubGlobal('fetch', request)
  await expect(readLinearIssues({ search: 'team-11', cursor: 'previous' })).resolves.toEqual({
    items: [
      {
        id: '1',
        identifier: 'TEAM-11',
        title: 'Fix timer',
        description: '',
        url: 'https://linear.app/team/issue/TEAM-11',
        status: 'In progress',
      },
    ],
    next: 'next-cursor',
  })
  const [url, init] = request.mock.calls[0]
  expect(url).toBe('https://api.linear.app/graphql')
  expect(init?.headers).toMatchObject({ Authorization: 'local-test-key' })
  const body = JSON.parse(typeof init?.body === 'string' ? init.body : '')
  expect(body.query).toMatch(/^query /)
  expect(body.variables).toEqual({
    after: 'previous',
    first: 25,
    filter: { team: { key: { eq: 'TEAM' } }, number: { eq: 11 } },
  })
})

it('avoids network access without a key and reports expired credentials separately', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 401 }))
  vi.stubGlobal('fetch', request)
  vi.stubEnv('DOVO_LINEAR_API_KEY', '')
  await expect(readLinearIssues({})).rejects.toThrow('not configured')
  expect(request).not.toHaveBeenCalled()
  vi.stubEnv('DOVO_LINEAR_API_KEY', 'local-test-key')
  await expect(readLinearIssues({})).rejects.toThrow('rejected')
})
