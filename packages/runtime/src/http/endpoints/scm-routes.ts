import {
  linkedPullRequestSchema,
  addTaskPullLinks,
  pullReference,
  verifyPullUrl,
  pullHeadBranch,
} from '@dovo/protocol'
import { gitActionState } from '../../scm/git/action-state.js'
import { retainChangedFiles } from '../../scm/git/retain-changes.js'
import {
  repositoryFolderSchema,
  createGithubRepositorySchema,
  openRepositorySchema,
} from '@dovo/protocol'
import { routeProgram, serviceResult } from '../support/effect.js'
import { mutableStruct, withDefault, mutableArray } from '@dovo/protocol'
import { minValue, maxValue, refine, decode } from '@dovo/protocol'
import { listJiraProjects } from '../../scm/forges/providers/jira.js'
import { homedir } from 'node:os'
import {
  saveJiraSourceEffect,
  removeJiraSource,
  linkJiraIssueEffect,
} from '../../scm/forges/providers/jira-sources.js'
import { listBranchesEffect, switchBranchEffect } from '../../scm/git/branches.js'
import { addRepositoryEffect } from '../../scm/repositories/repositories.js'
import { listDirectories } from '../../scm/repositories/directories.js'
import { listGithubRepositories } from '../../scm/forges/providers/github-repositories.js'
import { createPullTaskEffect } from '../../scm/pulls/pull-task.js'
import { createWorkTaskEffect } from '../../scm/tasks/work-task.js'
import {
  listWorktreesEffect,
  removeWorktreeEffect,
  worktreeChoicesEffect,
} from '../../scm/git/worktrees.js'
import { branchChanges } from '../../scm/work/change-summary.js'
import { ProjectInstructions } from '../../scm/repositories/project-instructions.js'
import sharp from 'sharp'
import type { IncomingMessage } from 'node:http'
import { Schema, Effect } from 'effect'
import {
  forgeBindingSchema,
  forgeCliProfileQuerySchema,
  forgeCliProfilesSchema,
  pullActionSchema,
  pullCreateSchema,
} from '@dovo/protocol'
import { RuntimeServices } from '../../services.js'
import { HttpError } from '../../errors.js'
import { body } from '../support/body.js'
const idSchema = maxValue(minValue(Schema.String, 1), 200)
export function scmRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      const method = request.method
      if (method === 'POST' && path === '/api/scm/pulls/link-thread') {
        const input = decode(
          mutableStruct({
            id: idSchema,
            pulls: minValue(maxValue(mutableArray(linkedPullRequestSchema), 20), 1),
          }),
          yield* serviceResult(body(request)),
        )
        try {
          for (const pull of input.pulls) {
            const reference = pullReference(pull.url)
            if (reference.number !== pull.number)
              throw new Error('PR number does not match its URL')
            verifyPullUrl(reference.url, pull.url)
          }
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error))
        }
        const task = s.store.task(input.id)
        if (task.archivedAt)
          throw new HttpError(409, 'Reopen this archived thread before linking PRs.')
        try {
          addTaskPullLinks(task, input.pulls)
        } catch (error) {
          throw new HttpError(400, error instanceof Error ? error.message : String(error))
        }
        s.store.update((workspace) => ({
          ...workspace,
          tasks: workspace.tasks.map((current) =>
            current.id === input.id ? addTaskPullLinks(current, input.pulls) : current,
          ),
        }))
        return { ok: true }
      }
      if (method === 'POST' && path === '/api/scm/repositories/icon') {
        const input = decode(
          mutableStruct({
            repositoryId: idSchema,
            data: Schema.optional(
              maxValue(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9+/=]+$/)), 3 * 1024 * 1024),
            ),
          }),
          yield* serviceResult(body(request, 4 * 1024 * 1024)),
        )
        if (!s.store.get().repositories.some((repo) => repo.id === input.repositoryId))
          throw new HttpError(404, 'Project not found')
        let iconOverride: string | undefined
        if (input.data) {
          const source = Buffer.from(input.data, 'base64')
          if (source.length > 2 * 1024 * 1024)
            throw new HttpError(413, 'Choose an image smaller than 2 MB')
          try {
            const image = yield* serviceResult(
              sharp(source, { limitInputPixels: 4 * 1024 * 1024 })
                .resize(48, 48, { fit: 'contain', background: '#00000000' })
                .png({ palette: true })
                .toBuffer(),
            )
            iconOverride = `data:image/png;base64,${image.toString('base64')}`
          } catch {
            throw new HttpError(400, 'Choose a valid PNG, JPEG, or WebP image')
          }
          if (iconOverride.length > 50000)
            throw new HttpError(413, 'This image is too detailed for a task icon')
        }
        s.store.update((workspace) => ({
          ...workspace,
          repositories: workspace.repositories.map((repo) =>
            repo.id === input.repositoryId ? { ...repo, iconOverride } : repo,
          ),
        }))
        return yield* serviceResult({ ok: true })
      }
      if (method === 'POST' && path.startsWith('/api/scm/instructions/')) {
        const input = decode(
          mutableStruct({
            repositoryId: idSchema,
            name: Schema.Literal('AGENTS.md', 'CLAUDE.md'),
            text: Schema.optional(maxValue(Schema.String, 200_000)),
            version: Schema.optional(Schema.String),
          }),
          yield* serviceResult(body(request)),
        )
        const editor = new ProjectInstructions(s.store)
        if (path === '/api/scm/instructions/read')
          return yield* serviceResult(editor.read(input.repositoryId, input.name))
        if (input.text === undefined || !input.version)
          throw new HttpError(400, 'Instruction text and version are required')
        if (path === '/api/scm/instructions/preview')
          return yield* serviceResult(
            editor.preview(input.repositoryId, input.name, input.text, input.version),
          )
        if (path === '/api/scm/instructions/save')
          return yield* serviceResult(
            editor.save(input.repositoryId, input.name, input.text, input.version),
          )
      }
      if (method === 'POST' && path === '/api/scm/worktrees/read')
        return yield* listWorktreesEffect(s)
      if (method === 'POST' && path === '/api/scm/worktrees/choices') {
        const { repositoryId } = decode(
          mutableStruct({ repositoryId: idSchema }),
          yield* serviceResult(body(request)),
        )
        return yield* worktreeChoicesEffect(s, repositoryId)
      }
      if (method === 'POST' && path === '/api/scm/worktrees/remove') {
        const { path: worktree } = decode(
          mutableStruct({ path: maxValue(minValue(Schema.String, 1), 4096) }),
          yield* serviceResult(body(request)),
        )
        return yield* removeWorktreeEffect(s, worktree)
      }
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
        const { id, revision } = decode(
          mutableStruct({
            id: idSchema,
            revision: Schema.optional(Schema.String),
          }),
          yield* serviceResult(body(request)),
        )
        if (s.store.get().repositories.some((repo) => repo.forge?.connectionId === id))
          throw new HttpError(409, 'Disconnect this account from its projects before removing it')
        s.forges.remove(id, revision)
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
        if (path === '/api/scm/action-state') {
          const [status, remotes] = yield* serviceResult(
            Promise.all([
              s.git.command(cwd, ['status', '--porcelain=v2', '--branch']),
              s.git.command(cwd, ['remote']),
            ]),
          )
          return gitActionState(status, remotes)
        }
        if (path === '/api/scm/push') {
          yield* serviceResult(s.git.push(cwd))
          return { ok: true }
        }
        if (path === '/api/scm/open-folder') {
          const { target } = decode(openRepositorySchema, input)
          yield* serviceResult(s.git.openFolder(cwd, target))
          return { ok: true }
        }
        if (repo.kind) throw new HttpError(400, 'This project does not use Git')
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
        if (path === '/api/scm/pulls/describe') {
          const { head, base } = decode(
            mutableStruct({
              head: maxValue(minValue(Schema.String, 1), 400),
              base: maxValue(minValue(Schema.String, 1), 400),
            }),
            input,
          )
          // Conversation context from the given task, or the newest task on the head branch.
          const task =
            input.taskId ??
            [...s.store.get().tasks]
              .reverse()
              .find((item) => item.repositoryId === repo.id && item.checkoutBranch === head)?.id
          const changes = yield* serviceResult(branchChanges(s.git, cwd, base, head))
          return yield* s.titles.pullDescriptionEffect({ taskId: task, ...changes })
        }
        if (path === '/api/scm/pulls/create') {
          const create = decode(pullCreateSchema, input)
          if (create.parentNumber !== undefined) {
            if (!create.parentHeadSha)
              throw new HttpError(400, 'Refresh the parent PR before creating a stacked PR.')
            const { pull: parent } = yield* serviceResult(s.pulls.detail(cwd, create.parentNumber))
            if (
              parent.state !== 'open' ||
              parent.headSha !== create.parentHeadSha ||
              pullHeadBranch(parent) !== create.base
            )
              throw new HttpError(
                409,
                'The parent PR changed. Refresh it before creating a stacked PR.',
              )
            if (create.head === create.base)
              throw new HttpError(400, 'Choose a different source branch for the next PR.')
            create.body =
              `${create.body.trimEnd()}\n\nStack parent: [#${parent.number}](${parent.url})`.trim()
            decode(pullCreateSchema, create)
          }
          const result = yield* serviceResult(s.pulls.create(cwd, create))
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
          return yield* s.pullCache.overviewEffect(
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
          return yield* s.pullCache.detailWithStackEffect(
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
          let files = yield* serviceResult(s.git.changes(cwd))
          if (typeof input.taskId === 'string') {
            const previous = s.store.task(input.taskId).files
            files = retainChangedFiles(previous, files)
            if (files !== previous) s.store.updateTask(input.taskId, (t) => ({ ...t, files }))
          }
          return yield* serviceResult({
            files,
          })
        }
        if (path === '/api/scm/branch-changes')
          return yield* serviceResult(s.git.branchChangesFiles(cwd))
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
