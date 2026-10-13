// A private Gitea fixture for exercising the Rust client through the real Node runtime.
import { createServer } from 'node:http'
import { writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

const directory = process.argv[2]
if (!directory) throw new Error('Pass a temporary fixture directory')
let address
const stamp = '2026-10-13T10:00:00Z'
const issues = Array.from({ length: 61 }, (_, index) => ({
  number: index + 1,
  title: `Native fixture issue ${index + 1}`,
  body: 'A **native** issue description.',
  state: 'open',
  user: { login: 'fixture' },
  assignees: [],
  labels: [],
  updated_at: stamp,
  content_version: 1,
}))
const comments = Array.from({ length: 51 }, (_, index) => ({
  id: index + 1,
  body: `Comment ${index + 1}`,
  user: { login: 'fixture' },
  created_at: stamp,
}))
const workflows = [{ id: 'ci.yaml', name: 'Native CI', state: 'active' }]
const pulls = [
  {
    number: 1,
    title: 'Native pull request',
    body: 'Review fixture',
    state: 'open',
    head: 'feature',
    base: 'main',
    headSha: 'a'.repeat(40),
    merged: false,
  },
  {
    number: 2,
    title: 'Native stacked pull request',
    body: 'Depends on the first PR',
    state: 'open',
    head: 'feature-top',
    base: 'feature',
    headSha: 'c'.repeat(40),
    merged: false,
  },
]
const reviews = []
let runNumber = 1
const runs = [
  {
    id: 1,
    name: 'Native CI',
    display_title: 'Fixture pipeline',
    status: 'completed',
    conclusion: 'success',
  },
]
const server = createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== 'token fixture-token') {
      response.writeHead(401).end()
      return
    }
    const url = new URL(request.url, address)
    let text = ''
    for await (const chunk of request) text += chunk
    const input = text ? JSON.parse(text) : undefined
    await appendFile(
      join(directory, 'forge-requests.jsonl'),
      JSON.stringify({
        method: request.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        input,
      }) + '\n',
    )
    const send = (value, status = 200) =>
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value))
    const normalizeIssue = (issue) => ({
      ...issue,
      html_url: `${address}/team/project/issues/${issue.number}`,
    })
    const normalizeComment = (comment) => ({
      ...comment,
      html_url: `${address}/team/project/issues/1#comment-${comment.id}`,
    })
    const normalizeRun = (run) => ({
      ...run,
      html_url: `${address}/team/project/actions/runs/${run.id}`,
      head_branch: 'main',
      head_sha: 'a'.repeat(40),
      actor: { login: 'fixture' },
      created_at: stamp,
      updated_at: stamp,
      workflow_id: 'ci.yaml',
    })
    const normalizePull = (pull) => ({
      number: pull.number,
      title: pull.title,
      body: pull.body,
      state: pull.state,
      merged: pull.merged,
      html_url: `${address}/team/project/pulls/${pull.number}`,
      user: { login: 'fixture' },
      updated_at: stamp,
      head: { label: pull.head, ref: pull.head, sha: pull.headSha },
      base: { label: pull.base, ref: pull.base, sha: 'b'.repeat(40) },
    })
    const path = url.pathname.replace('/api/v1/repos/team/project', '')
    if (url.pathname === '/api/v1/version') return send({ version: '1.27.0' })
    if (url.pathname === '/api/v1/user') return send({ login: 'fixture' })
    if (url.pathname === '/api/v1/repos/team/project')
      return send({
        id: 1,
        name: 'project',
        full_name: 'team/project',
        html_url: `${address}/team/project`,
        clone_url: `${address}/team/project.git`,
        default_branch: 'main',
        allow_merge_commits: true,
        allow_squash_merge: true,
        allow_rebase: true,
      })
    if (path === '/pulls') {
      if (request.method === 'POST') {
        const pull = {
          number: pulls.length + 1,
          title: input.title,
          body: input.body,
          state: 'open',
          head: input.head,
          base: input.base,
          headSha: 'a'.repeat(40),
          merged: false,
        }
        pulls.push(pull)
        return send(normalizePull(pull), 201)
      }
      const state = url.searchParams.get('state') ?? 'open',
        page = Number(url.searchParams.get('page') ?? 1)
      return send(
        pulls
          .filter((pull) => state === 'all' || pull.state === state)
          .slice((page - 1) * 50, page * 50)
          .map(normalizePull),
      )
    }
    if (/^\/commits\/[a-f0-9]+\/status$/.test(path))
      return send({ state: 'success', total_count: 0, statuses: [] })
    const pullMatch =
      /^\/pulls\/(\d+)(\/reviews|\/files|\/merge|\/requested_reviewers|\.diff)?$/.exec(path)
    if (pullMatch) {
      const pull = pulls.find((pull) => pull.number === Number(pullMatch[1]))
      if (!pull) return send({}, 404)
      if (pullMatch[2] === '/reviews') {
        if (request.method === 'POST') {
          reviews.push({
            id: reviews.length + 1,
            body: input.body,
            state: input.event,
            commit_id: input.commit_id,
            user: { login: 'fixture' },
            submitted_at: stamp,
            html_url: `${address}/team/project/pulls/${pull.number}#review`,
          })
          return send(reviews.at(-1), 201)
        }
        return send(url.searchParams.get('page') === '2' ? [] : reviews)
      }
      if (pullMatch[2] === '/files') return send([])
      if (pullMatch[2] === '.diff')
        return response.writeHead(200, { 'Content-Type': 'text/plain' }).end('')
      if (pullMatch[2] === '/requested_reviewers') return send({}, 204)
      if (pullMatch[2] === '/merge') {
        if (input.head_commit_id !== pull.headSha) return send({}, 409)
        pull.merged = true
        pull.state = 'closed'
        return send({}, 204)
      }
      if (request.method === 'PATCH')
        for (const field of ['title', 'body', 'base', 'state'])
          if (input[field] !== undefined) pull[field] = input[field]
      return send(normalizePull(pull))
    }
    if (path === '/issues') {
      if (request.method === 'POST') {
        const issue = {
          ...issues[0],
          number: issues.length + 1,
          title: input.title,
          body: input.body,
          assignees: input.assignees.map((login) => ({ login })),
          content_version: 1,
        }
        issues.push(issue)
        return send(normalizeIssue(issue), 201)
      }
      const page = Number(url.searchParams.get('page') ?? 1)
      const query = url.searchParams.get('q')?.toLowerCase()
      const state = url.searchParams.get('state') ?? 'open'
      const filtered = issues.filter(
        (issue) =>
          (state === 'all' || issue.state === state) &&
          (!query || issue.title.toLowerCase().includes(query)),
      )
      return send(filtered.slice((page - 1) * 30, page * 30).map(normalizeIssue))
    }
    const issueMatch = /^\/issues\/(\d+)(\/comments)?$/.exec(path)
    if (issueMatch) {
      const issue = issues.find((issue) => issue.number === Number(issueMatch[1]))
      if (!issue) return send({ message: 'Missing issue' }, 404)
      if (issueMatch[2]) {
        if (request.method === 'POST') {
          comments.push({
            id: comments.length + 1,
            body: input.body,
            user: { login: 'fixture' },
            created_at: stamp,
          })
          return send(normalizeComment(comments.at(-1)), 201)
        }
        const page = Number(url.searchParams.get('page') ?? 1)
        return send(comments.slice((page - 1) * 50, page * 50).map(normalizeComment))
      }
      if (request.method === 'PATCH') {
        if (input.content_version !== issue.content_version)
          return send({ message: 'Conflict' }, 409)
        for (const field of ['title', 'body', 'state'])
          if (input[field] !== undefined) issue[field] = input[field]
        if (input.assignees) issue.assignees = input.assignees.map((login) => ({ login }))
        issue.content_version++
      }
      return send(normalizeIssue(issue))
    }
    if (path === '/actions/workflows') return send({ workflows })
    const workflow = /^\/actions\/workflows\/([^/]+)\/(dispatches|enable|disable)$/.exec(path)
    if (workflow) {
      if (workflow[2] === 'dispatches') {
        runs.push({
          id: ++runNumber,
          name: 'Native CI',
          display_title: `Dispatched ${input.ref}`,
          status: 'queued',
        })
        return send({}, 204)
      }
      workflows[0].state = workflow[2] === 'enable' ? 'active' : 'disabled'
      return send({}, 204)
    }
    if (path === '/actions/runs') return send({ workflow_runs: runs.map(normalizeRun) })
    const run = /^\/actions\/runs\/(\d+)(\/jobs|\/rerun)?$/.exec(path)
    if (run) {
      const selected = runs.find((value) => value.id === Number(run[1]))
      if (!selected) return send({}, 404)
      if (run[2] === '/jobs')
        return send({
          jobs: [
            {
              id: 1,
              name: 'Check',
              status: 'completed',
              conclusion: 'success',
              html_url: `${address}/team/project/actions/runs/${run[1]}`,
              steps: [{ number: 0, name: 'Build', status: 'completed', conclusion: 'success' }],
            },
          ],
        })
      if (run[2] === '/rerun') {
        selected.status = 'queued'
        selected.conclusion = null
        return send({}, 204)
      }
      return send(normalizeRun(selected))
    }
    return send({ message: `Unhandled fixture request ${request.method} ${url.pathname}` }, 404)
  } catch (error) {
    response
      .writeHead(500, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ message: String(error) }))
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
address = `http://127.0.0.1:${server.address().port}`
await writeFile(join(directory, 'forge-address.json'), JSON.stringify({ address }))
process.on('SIGTERM', () => server.close(() => process.exit(0)))
