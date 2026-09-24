import {
  repositoryFolderSchema,
  createGithubRepositorySchema,
  openRepositorySchema,
} from '@dovo/protocol'
import { routeProgram, serviceResult } from './effect.js'
import { mutableStruct, withDefault, mutableArray } from '@dovo/protocol'
import { minValue, maxValue, refine, decode } from '@dovo/protocol'
import { listJiraProjects } from '../scm/jira.js'
import { homedir } from 'node:os'
import { saveJiraSourceEffect, removeJiraSource, linkJiraIssueEffect } from '../scm/jira-sources.js'
import { listBranchesEffect, switchBranchEffect } from '../scm/branches.js'
import { addRepositoryEffect } from '../scm/repositories.js'
import { listDirectories } from '../scm/directories.js'
import { listGithubRepositories } from '../scm/github-repositories.js'
import { createPullTaskEffect } from '../scm/pull-task.js'
import { createWorkTaskEffect } from '../scm/work-task.js'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import {
  forgeBindingSchema,
  forgeCliProfileQuerySchema,
  forgeCliProfilesSchema,
  pullActionSchema,
  pullCreateSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../services.js'
import { HttpError } from '../errors.js'
import { body } from './body.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
export function scmRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method
      if (method === 'POST' && path === '/api/scm/jira/projects/read')
        return yield* serviceResult(listJiraProjects(s.commands.get().acli, homedir()))
      if (method === 'POST' && path === '/api/scm/jira/sources/save')
        return yield* saveJiraSourceEffect(s, yield* serviceResult(body(request)))
      if (method === 'POST' && path === '/api/scm/jira/sources/remove')
        return yield* serviceResult(removeJiraSource(s, yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/scm/jira/issues/link')
        return yield* linkJiraIssueEffect(s, yield* serviceResult(body(request)))
      if (method === 'POST' && path === '/api/scm/jira/bind')
        throw new HttpError(
          409,
          'Jira is now an independent issue source. Update the app and connect it from Issues → Sources.',
        )
      if (method === 'POST' && path === '/api/scm/work/task')
        return yield* createWorkTaskEffect(s, yield* serviceResult(body(request)))
      if (method === 'POST' && path.startsWith('/api/scm/work/')) {
        const input = decode(
          refine(
            Schema.Struct(
              mutableStruct({
                repositoryId: Schema.optional(idSchema),
                jiraSourceId: Schema.optional(idSchema),
              }).fields,
              {
                key: Schema.String,
                value: Schema.Unknown,
              },
            ),
            (input) => !!input.repositoryId !== !!input.jiraSourceId,
            'Choose one issue source',
          ),
          yield* serviceResult(body(request)),
        )
        const operation = path.slice('/api/scm/work/'.length)
        return yield* serviceResult(
          input.jiraSourceId
            ? s.forgeWork.requestJira(input.jiraSourceId, operation, input)
            : s.forgeWork.request(input.repositoryId!, operation, input),
        )
      }
      if (method === 'POST' && path === '/api/scm/cli-profiles/read') {
        const input = decode(forgeCliProfileQuerySchema, yield* serviceResult(body(request)))
        const repository = input.repositoryId
          ? s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
          : undefined
        if (input.repositoryId && !repository) throw new HttpError(404, 'Repository not found')
        return yield* serviceResult(
          decode(
            forgeCliProfilesSchema,
            yield* serviceResult(s.forgeCli.profiles(input, repository?.path)),
          ),
        )
      }
      if (method === 'POST' && path === '/api/scm/connections/read')
        return yield* serviceResult({
          connections: s.forges.list(),
        })
      if (method === 'POST' && path === '/api/scm/connections/save') {
        const result = s.forges.save(yield* serviceResult(body(request)))
        for (const repo of s.store.get().repositories)
          if (repo.forge?.connectionId === result.id) s.pullCache.invalidate(repo.path)
        // Publish a workspace revision so clients discard cached results from the old account.
        s.store.update((workspace) => ({
          ...workspace,
          repositories: workspace.repositories.map((repo) =>
            repo.forge?.connectionId === result.id
              ? {
                  ...repo,
                  forge: {
                    ...repo.forge,
                    revision: result.revision,
                  },
                }
              : repo,
          ),
        }))
        return yield* serviceResult(result)
      }
      if (method === 'POST' && path === '/api/scm/connections/remove') {
        const { id } = decode(
          mutableStruct({
            id: idSchema,
          }),
          yield* serviceResult(body(request)),
        )
        if (s.store.get().repositories.some((repo) => repo.forge?.connectionId === id))
          throw new HttpError(409, 'Disconnect this account from its projects before removing it')
        s.forges.remove(id)
        return yield* serviceResult({
          ok: true,
        })
      }
      if (
        method === 'POST' &&
        (path === '/api/scm/repositories/forge/read' ||
          path === '/api/scm/repositories/forge/inspect')
      ) {
        const input = decode(
          mutableStruct({
            connectionId: idSchema,
            repository: Schema.optionalWith(maxValue(Schema.String, 500), {
              default: () => '',
            }),
            page: Schema.optionalWith(
              maxValue(
                minValue(
                  Schema.Number.pipe(Schema.finite()).pipe(
                    Schema.int(),
                    Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
                  ),
                  1,
                ),
                1000,
              ),
              {
                default: () => 1,
              },
            ),
            repositoryId: Schema.optional(idSchema),
          }),
          yield* serviceResult(body(request)),
        )
        const repository = input.repositoryId
          ? s.store.get().repositories.find((repo) => repo.id === input.repositoryId)
          : undefined
        if (input.repositoryId && !repository) throw new HttpError(404, 'Repository not found')
        const adapter = s.pulls.adapter(input.connectionId, input.repository, repository?.path)
        return yield* serviceResult(
          path.endsWith('/inspect') ? adapter.repository() : adapter.repositories(input.page),
        )
      }
      if (method === 'POST' && path === '/api/scm/directories/read')
        return yield* serviceResult(listDirectories(yield* serviceResult(body(request))))
      if (method === 'POST' && path === '/api/scm/repositories/github/read')
        return yield* serviceResult(
          listGithubRepositories(s.git, yield* serviceResult(body(request))),
        )
      if (method === 'POST' && path === '/api/scm/repositories/git-status') {
        const input = decode(repositoryFolderSchema, yield* serviceResult(body(request)))
        return yield* serviceResult(s.git.folderStatus(input.path))
      }
      if (method === 'POST' && path === '/api/scm/repositories/github/create') {
        const input = decode(createGithubRepositorySchema, yield* serviceResult(body(request)))
        return yield* serviceResult(s.git.createGithub(input.path, input.name, input.visibility))
      }
      if (method === 'POST' && path === '/api/scm/repositories/add')
        return yield* addRepositoryEffect(s, yield* serviceResult(body(request)))
      if (method === 'POST' && path.startsWith('/api/scm/')) {
        const input = decode(
          Schema.Struct(
            mutableStruct({
              repositoryId: idSchema,
              taskId: Schema.optional(idSchema),
            }).fields,
            {
              key: Schema.String,
              value: Schema.Unknown,
            },
          ),
          yield* serviceResult(body(request)),
        )
        const repo = s.store.get().repositories.find((r) => r.id === input.repositoryId)
        if (!repo) throw new HttpError(404, 'Repository not found')
        if (input.taskId && s.store.task(input.taskId).repositoryId !== repo.id)
          throw new HttpError(400, 'Task repository does not match')
        const cwd = input.taskId
          ? yield* serviceResult(s.checkouts.directory(input.taskId))
          : repo.path
        if (path === '/api/scm/push') {
          yield* serviceResult(s.git.push(cwd))
          return { ok: true }
        }
        if (path === '/api/scm/open-folder') {
          const { target } = decode(openRepositorySchema, input)
          yield* serviceResult(s.git.openFolder(cwd, target))
          return { ok: true }
        }
        if (path === '/api/scm/pulls/options/read')
          return yield* serviceResult(s.pulls.createOptions(cwd))
        if (path === '/api/scm/repositories/forge/bind') {
          const binding = input.forge === null ? undefined : decode(forgeBindingSchema, input.forge)
          if (binding) {
            yield* serviceResult(
              s.pulls.adapter(binding.connectionId, binding.repository, cwd).repository(),
            )
            binding.revision = s.forges.get(binding.connectionId).revision
          }
          s.store.update((workspace) => ({
            ...workspace,
            repositories: workspace.repositories.map((item) =>
              item.id === repo.id
                ? {
                    ...item,
                    forge: binding,
                  }
                : item,
            ),
          }))
          s.pullCache.invalidate(repo.path)
          return yield* serviceResult({
            ok: true,
          })
        }
        if (path === '/api/scm/pulls/create') {
          const result = yield* serviceResult(s.pulls.create(cwd, decode(pullCreateSchema, input)))
          s.pullCache.invalidate(cwd)
          return yield* serviceResult(result)
        }
        if (path === '/api/scm/pulls/action') {
          const action = decode(pullActionSchema, input)
          const result = yield* serviceResult(s.pulls.act(cwd, action))
          s.pullCache.invalidate(cwd, action.number)
          return yield* serviceResult(result)
        }
        if (path === '/api/scm/branches') return yield* listBranchesEffect(s, cwd)
        if (path === '/api/scm/branch')
          return yield* switchBranchEffect(
            s,
            (yield* serviceResult(s.git.inspect(cwd))).path,
            input.taskId,
            input,
          )
        if (path === '/api/scm/pulls/comment') {
          const result = yield* serviceResult(s.pulls.comment(cwd, input))
          s.pullCache.invalidate(
            cwd,
            decode(
              Schema.Number.pipe(Schema.finite())
                .pipe(
                  Schema.int(),
                  Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
                )
                .pipe(Schema.positive()),
              input.number,
            ),
          )
          return yield* serviceResult(result)
        }
        if (path === '/api/scm/pulls/task')
          return yield* createPullTaskEffect(s, repo.id, cwd, input)
        if (path === '/api/scm/pulls/overview')
          return yield* s.pullCache.listEffect(
            cwd,
            decode(
              withDefault(Schema.Literal('open', 'closed', 'all'), () => 'open' as const),
              input.state,
            ),
            decode(
              withDefault(
                maxValue(
                  minValue(
                    Schema.Number.pipe(Schema.finite()).pipe(
                      Schema.int(),
                      Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
                    ),
                    1,
                  ),
                  10000,
                ),
                () => 1,
              ),
              input.page,
            ),
            decode(
              withDefault(Schema.Boolean, () => false),
              input.refresh,
            ),
          )
        if (path === '/api/scm/pulls/detail')
          return yield* s.pullCache.detailEffect(
            cwd,
            decode(
              Schema.Number.pipe(Schema.finite())
                .pipe(
                  Schema.int(),
                  Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
                )
                .pipe(Schema.positive()),
              input.number,
            ),
            decode(
              withDefault(Schema.Boolean, () => false),
              input.refresh,
            ),
          )
        if (path === '/api/scm/inspect') {
          const result = yield* serviceResult(s.git.inspect(cwd))
          if (!input.taskId)
            s.store.update((w) => ({
              ...w,
              repositories: w.repositories.map((r) =>
                r.id === repo.id
                  ? {
                      ...r,
                      ...result,
                    }
                  : r,
              ),
            }))
          return yield* serviceResult(result)
        }
        if (path === '/api/scm/changes') {
          const files = yield* serviceResult(s.git.changes(cwd))
          if (typeof input.taskId === 'string') {
            s.store.updateTask(input.taskId, (t) => ({
              ...t,
              files,
            }))
          }
          return yield* serviceResult({
            files,
          })
        }
        if (path === '/api/scm/apply') {
          const data = decode(
            mutableStruct({
              path: Schema.String,
              expected: Schema.String,
              contents: Schema.String,
            }),
            input,
          )
          yield* serviceResult(s.git.save(cwd, data.path, data.expected, data.contents))
          return yield* serviceResult({
            ok: true,
          })
        }
        if (path === '/api/scm/stage') {
          yield* serviceResult(
            s.git.stage(cwd, decode(maxValue(mutableArray(Schema.String), 200), input.paths)),
          )
          return yield* serviceResult({
            ok: true,
          })
        }
        if (path === '/api/scm/commit') {
          return yield* serviceResult({
            commit: yield* serviceResult(
              s.git.commit(
                cwd,
                decode(
                  maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 4000),
                  input.message,
                ),
              ),
            ),
          })
        }
        if (path === '/api/scm/pulls')
          return yield* serviceResult({
            pulls: yield* serviceResult(s.git.pullRequests(cwd)),
          })
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
