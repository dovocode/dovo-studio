import { listJiraProjects } from '../scm/jira.js'
import { homedir } from 'node:os'
import { saveJiraSource, removeJiraSource, linkJiraIssue } from '../scm/jira-sources.js'
import { listBranches, switchBranch } from '../scm/branches.js'
import { addRepository } from '../scm/repositories.js'
import { listDirectories } from '../scm/directories.js'
import { listGithubRepositories } from '../scm/github-repositories.js'
import { createPullTask } from '../scm/pull-task.js'
import { createWorkTask } from '../scm/work-task.js'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import {
  forgeBindingSchema,
  forgeCliProfileQuerySchema,
  forgeCliProfilesSchema,
  pullActionSchema,
  pullCreateSchema,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
const idSchema = z.string().min(1).max(200)
export async function scmRoute(
  request: IncomingMessage,
  path: string,
  s: Services,
): Promise<unknown> {
  const method = request.method
  if (method === 'POST' && path === '/api/scm/jira/projects/read')
    return listJiraProjects(s.commands.get().acli, homedir())
  if (method === 'POST' && path === '/api/scm/jira/sources/save')
    return saveJiraSource(s, await body(request))
  if (method === 'POST' && path === '/api/scm/jira/sources/remove')
    return removeJiraSource(s, await body(request))
  if (method === 'POST' && path === '/api/scm/jira/issues/link')
    return linkJiraIssue(s, await body(request))
  if (method === 'POST' && path === '/api/scm/jira/bind')
    throw new HttpError(
      409,
      'Jira is now an independent issue source. Update the app and connect it from Issues → Sources.',
    )
  if (method === 'POST' && path === '/api/scm/work/task')
    return createWorkTask(s, await body(request))
  if (method === 'POST' && path.startsWith('/api/scm/work/')) {
    const input = z
      .object({ repositoryId: idSchema.optional(), jiraSourceId: idSchema.optional() })
      .passthrough()
      .refine((input) => !!input.repositoryId !== !!input.jiraSourceId, 'Choose one issue source')
      .parse(await body(request))
    const operation = path.slice('/api/scm/work/'.length)
    return input.jiraSourceId
      ? s.forgeWork.requestJira(input.jiraSourceId, operation, input)
      : s.forgeWork.request(input.repositoryId!, operation, input)
  }
  if (method === 'POST' && path === '/api/scm/cli-profiles/read') {
    const input = forgeCliProfileQuerySchema.parse(await body(request))
    const repository = input.repositoryId
      ? s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
      : undefined
    if (input.repositoryId && !repository) throw new HttpError(404, 'Repository not found')
    return forgeCliProfilesSchema.parse(await s.forgeCli.profiles(input, repository?.path))
  }
  if (method === 'POST' && path === '/api/scm/connections/read')
    return { connections: s.forges.list() }
  if (method === 'POST' && path === '/api/scm/connections/save') {
    const result = s.forges.save(await body(request))
    for (const repo of s.store.get().repositories)
      if (repo.forge?.connectionId === result.id) s.pullCache.invalidate(repo.path)
    // Publish a workspace revision so clients discard cached results from the old account.
    s.store.update((workspace) => ({
      ...workspace,
      repositories: workspace.repositories.map((repo) =>
        repo.forge?.connectionId === result.id
          ? { ...repo, forge: { ...repo.forge, revision: result.revision } }
          : repo,
      ),
    }))
    return result
  }
  if (method === 'POST' && path === '/api/scm/connections/remove') {
    const { id } = z.object({ id: idSchema }).parse(await body(request))
    if (s.store.get().repositories.some((repo) => repo.forge?.connectionId === id))
      throw new HttpError(409, 'Disconnect this account from its projects before removing it')
    s.forges.remove(id)
    return { ok: true }
  }
  if (
    method === 'POST' &&
    (path === '/api/scm/repositories/forge/read' || path === '/api/scm/repositories/forge/inspect')
  ) {
    const input = z
      .object({
        connectionId: idSchema,
        repository: z.string().max(500).default(''),
        page: z.number().int().min(1).max(1000).default(1),
        repositoryId: idSchema.optional(),
      })
      .parse(await body(request))
    const repository = input.repositoryId
      ? s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
      : undefined
    if (input.repositoryId && !repository) throw new HttpError(404, 'Repository not found')
    const adapter = s.pulls.adapter(input.connectionId, input.repository, repository?.path)
    return path.endsWith('/inspect') ? adapter.repository() : adapter.repositories(input.page)
  }
  if (method === 'POST' && path === '/api/scm/directories/read')
    return listDirectories(await body(request))
  if (method === 'POST' && path === '/api/scm/repositories/github/read')
    return listGithubRepositories(s.git, await body(request))
  if (method === 'POST' && path === '/api/scm/repositories/add')
    return addRepository(s, await body(request))
  if (method === 'POST' && path.startsWith('/api/scm/')) {
    const input = z
      .object({ repositoryId: idSchema, taskId: idSchema.optional() })
      .passthrough()
      .parse(await body(request))
    const repo = s.store.get().repositories.find((r) => r.id === input.repositoryId)
    if (!repo) throw new HttpError(404, 'Repository not found')
    if (input.taskId && s.store.task(input.taskId).repositoryId !== repo.id)
      throw new HttpError(400, 'Task repository does not match')
    const cwd = input.taskId ? await s.checkouts.directory(input.taskId) : repo.path
    if (path === '/api/scm/pulls/options/read') return s.pulls.createOptions(cwd)
    if (path === '/api/scm/repositories/forge/bind') {
      const binding = input.forge === null ? undefined : forgeBindingSchema.parse(input.forge)
      if (binding) {
        await s.pulls.adapter(binding.connectionId, binding.repository, cwd).repository()
        binding.revision = s.forges.get(binding.connectionId).revision
      }
      s.store.update((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((item) =>
          item.id === repo.id ? { ...item, forge: binding } : item,
        ),
      }))
      s.pullCache.invalidate(repo.path)
      return { ok: true }
    }
    if (path === '/api/scm/pulls/create') {
      const result = await s.pulls.create(cwd, pullCreateSchema.parse(input))
      s.pullCache.invalidate(cwd)
      return result
    }
    if (path === '/api/scm/pulls/action') {
      const action = pullActionSchema.parse(input)
      const result = await s.pulls.act(cwd, action)
      s.pullCache.invalidate(cwd, action.number)
      return result
    }
    if (path === '/api/scm/branches') return listBranches(s, cwd)
    if (path === '/api/scm/branch')
      return switchBranch(s, (await s.git.inspect(cwd)).path, input.taskId, input)
    if (path === '/api/scm/pulls/comment') {
      const result = await s.pulls.comment(cwd, input)
      s.pullCache.invalidate(cwd, z.number().int().positive().parse(input.number))
      return result
    }
    if (path === '/api/scm/pulls/task') return createPullTask(s, repo.id, cwd, input)
    if (path === '/api/scm/pulls/overview')
      return s.pullCache.list(
        cwd,
        z.enum(['open', 'closed', 'all']).default('open').parse(input.state),
        z.number().int().min(1).max(10000).default(1).parse(input.page),
        z.boolean().default(false).parse(input.refresh),
      )
    if (path === '/api/scm/pulls/detail')
      return s.pullCache.detail(
        cwd,
        z.number().int().positive().parse(input.number),
        z.boolean().default(false).parse(input.refresh),
      )
    if (path === '/api/scm/inspect') {
      const result = await s.git.inspect(cwd)
      if (!input.taskId)
        s.store.update((w) => ({
          ...w,
          repositories: w.repositories.map((r) => (r.id === repo.id ? { ...r, ...result } : r)),
        }))
      return result
    }
    if (path === '/api/scm/changes') {
      const files = await s.git.changes(cwd)
      if (typeof input.taskId === 'string') {
        s.store.updateTask(input.taskId, (t) => ({ ...t, files }))
      }
      return { files }
    }
    if (path === '/api/scm/apply') {
      const data = z
        .object({ path: z.string(), expected: z.string(), contents: z.string() })
        .parse(input)
      await s.git.save(cwd, data.path, data.expected, data.contents)
      return { ok: true }
    }
    if (path === '/api/scm/stage') {
      await s.git.stage(cwd, z.array(z.string()).max(200).parse(input.paths))
      return { ok: true }
    }
    if (path === '/api/scm/commit') {
      return {
        commit: await s.git.commit(cwd, z.string().trim().min(1).max(4000).parse(input.message)),
      }
    }
    if (path === '/api/scm/pulls') return { pulls: await s.git.pullRequests(cwd) }
  }
  throw new HttpError(404, 'Endpoint not found')
}
