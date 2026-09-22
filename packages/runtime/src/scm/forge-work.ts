import { homedir } from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { JiraWork } from './jira.js'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import {
  forgeIssueActionSchema,
  forgeIssueCreateSchema,
  forgePipelineActionSchema,
  forgeWorkQuerySchema,
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgeIssueDetailSchema,
  forgePipelinePageSchema,
  forgePipelineDetailSchema,
  forgeDefinitionsSchema,
  forgeWorkResultSchema,
  type CommandSettings,
} from '@dovo/protocol'
import { connectionHttp } from './forge-connections.js'
import { GitForgeWork } from './forge-work-git.js'
import { AzureForgeWork } from './forge-work-azure.js'
import { BitbucketForgeWork } from './forge-work-bitbucket.js'
import type { ForgeWorkProvider } from './forge-work-types.js'
import type { ForgeConnections } from './forge-connections.js'
import type { ForgePullRequests } from './forge-pulls.js'
import type { GitService } from './git.js'
import type { WorkspaceStore } from '../storage/workspace.js'
import { HttpError, errorMessage } from '../errors.js'
import { runForgeCli } from './forge-cli.js'
export class ForgeWork {
  private versions = new Map<string, number>()
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private git: GitService,
    private forges: ForgeConnections,
    private pulls: ForgePullRequests,
    private commands: () => CommandSettings,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS forge_work_cache (key TEXT PRIMARY KEY, source TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL)',
    )
  }
  private async target(
    repositoryId: string,
  ): Promise<{ cwd: string; provider?: ForgeWorkProvider }> {
    const repo = this.store.get().repositories.find((v) => v.id === repositoryId)
    if (!repo) throw new HttpError(404, 'Project not found')
    const connection = repo.forge ? this.forges.get(repo.forge.connectionId) : undefined
    if (connection && connection.provider !== 'github') {
      const http = connectionHttp(this.forges, connection, repo.path)
      const repository = repo.forge!.repository
      return {
        cwd: repo.path,
        provider:
          connection.provider === 'azure-devops'
            ? new AzureForgeWork(http, repository)
            : connection.provider === 'bitbucket'
              ? new BitbucketForgeWork(http, repository)
              : new GitForgeWork(http, connection.provider, repository),
      }
    }
    let remote: { nameWithOwner: string; url: string }
    if (repo.forge) remote = { nameWithOwner: repo.forge.repository, url: connection!.baseUrl }
    else {
      let result: string
      try {
        result = await this.git.github(repo.path, ['repo', 'view', '--json', 'nameWithOwner,url'])
      } catch (error) {
        const stderr = z.object({ stderr: z.string() }).safeParse(error)
        const diagnostic = stderr.success ? stderr.data.stderr : errorMessage(error)
        // gh has no source to inspect for a local-only repository. Auth, network,
        // missing-directory and other Git failures must continue to surface.
        if (/^(?:Command failed: [^\r\n]+\r?\n)?no git remotes found\s*$/i.test(diagnostic.trim()))
          return { cwd: repo.path }
        throw error
      }
      remote = z.object({ nameWithOwner: z.string(), url: z.url() }).parse(JSON.parse(result))
    }
    const host = new URL(remote.url).hostname
    return {
      cwd: repo.path,
      provider: new GitForgeWork(
        {
          json: async (path, options) => {
            if (connection && this.forges.get(connection.id).revision !== connection.revision)
              throw new HttpError(
                409,
                'This source control account changed. Refresh before continuing.',
              )
            const token = connection
              ? await this.forges.githubToken(connection.id, repo.path)
              : undefined
            const result = await runForgeCli(
              this.commands().gh,
              [
                'api',
                '--hostname',
                host,
                path,
                '--method',
                options?.method ?? 'GET',
                ...(options?.body === undefined ? [] : ['--input', '-']),
              ],
              options?.body,
              repo.path,
              token
                ? {
                    GH_HOST: host,
                    GH_TOKEN: token,
                    GH_ENTERPRISE_TOKEN: token,
                    GITHUB_TOKEN: '',
                    GITHUB_ENTERPRISE_TOKEN: '',
                  }
                : undefined,
            )
            return result.trim() ? (JSON.parse(result) as unknown) : null
          },
        },
        'github',
        remote.nameWithOwner,
      ),
    }
  }
  async request(repositoryId: string, operation: string, input: unknown) {
    const selected = this.store.get().repositories.find((repo) => repo.id === repositoryId)
    if (!selected) throw new HttpError(404, 'Project not found')
    if (selected.forge) await this.forges.reconcileCli(selected.forge.connectionId, selected.path)
    const { cwd, provider } = await this.target(repositoryId)
    if (!provider) {
      if (operation === 'options')
        return forgeWorkOptionsSchema.parse({
          provider: 'github',
          issues: false,
          pipelines: false,
          pipelineActions: [],
        })
      if (operation === 'issues/list') return forgeIssuePageSchema.parse({ items: [] })
      if (operation === 'pipelines/list') return forgePipelinePageSchema.parse({ items: [] })
      throw new HttpError(404, 'This project has no remote source.')
    }
    return this.execute(provider, cwd, ['repository', repositoryId], operation, input, () => {
      const current = this.store.get().repositories.find((repo) => repo.id === repositoryId)
      if (
        !current ||
        current.path !== selected.path ||
        !isDeepStrictEqual(current.forge, selected.forge)
      )
        throw new HttpError(409, 'This project source changed. Refresh before continuing.')
    })
  }
  async requestJira(sourceId: string, operation: string, input: unknown) {
    const selected = this.store.get().jiraSources?.find((source) => source.id === sourceId)
    if (!selected) throw new HttpError(404, 'Jira source not found')
    const cwd = homedir()
    const validateSource = () => {
      const current = this.store.get().jiraSources?.find((source) => source.id === sourceId)
      if (!current || current.site !== selected.site || current.project !== selected.project)
        throw new HttpError(409, 'This Jira source changed. Refresh before continuing.')
    }
    const provider = new JiraWork(this.commands().acli, selected, undefined, cwd, validateSource)
    return this.execute(provider, cwd, ['jira', sourceId], operation, input, validateSource)
  }

  private async execute(
    provider: ForgeWorkProvider,
    cwd: string,
    sourceId: string[],
    operation: string,
    input: unknown,
    validateSource: () => void,
  ) {
    const data = z
      .object({
        id: z.string().max(300).optional(),
        type: z.string().max(100).optional(),
        area: z.enum(['issues', 'pipelines']).optional(),
      })
      .passthrough()
      .parse(input)
    const query = forgeWorkQuerySchema.parse(input)
    const area =
      operation === 'options'
        ? (data.area ?? 'issues')
        : operation.startsWith('pipelines/')
          ? 'pipelines'
          : 'issues'
    validateSource()
    if (operation === 'options') {
      const result = forgeWorkOptionsSchema.parse(await provider.options(data.type, area))
      validateSource()
      return result
    }
    const source = JSON.stringify([
      sourceId,
      provider instanceof JiraWork
        ? [provider.binding, await provider.identity()]
        : await this.pulls.identity(cwd, query.refresh),
    ])
    validateSource()
    const id = () => z.string().min(1).max(300).parse(data.id)
    if (
      operation === 'issues/create' ||
      operation === 'issues/action' ||
      operation === 'pipelines/action'
    ) {
      const result =
        operation === 'issues/create'
          ? await provider.createIssue(forgeIssueCreateSchema.parse(data))
          : operation === 'issues/action'
            ? await provider.actOnIssue(forgeIssueActionSchema.parse(data))
            : await provider.actOnPipeline(forgePipelineActionSchema.parse(data))
      this.versions.set(source, (this.versions.get(source) ?? 0) + 1)
      this.db.prepare('DELETE FROM forge_work_cache WHERE source=?').run(source)
      return forgeWorkResultSchema.parse(result)
    }
    const key = JSON.stringify([source, operation, data.id, query.state, query.cursor, query.query])
    const read = async <T extends { cachedAt?: string; stale?: boolean; refreshError?: string }>(
      schema: z.ZodType<T>,
      load: () => Promise<T>,
    ) => {
      const row = z
        .object({ value: z.string(), updated: z.number() })
        .optional()
        .parse(this.db.prepare('SELECT value,updated FROM forge_work_cache WHERE key=?').get(key))
      let cached: T | undefined
      if (row) {
        try {
          const result = schema.safeParse(JSON.parse(row.value))
          if (result.success) cached = result.data
        } catch {
          // Cache entries are disposable; invalid persisted JSON must not block the provider.
        }
        if (!cached) this.db.prepare('DELETE FROM forge_work_cache WHERE key=?').run(key)
      }
      if (row && cached && !query.refresh && Date.now() - row.updated < 30000)
        return { ...cached, cachedAt: new Date(row.updated).toISOString() }
      const version = this.versions.get(source) ?? 0
      try {
        const result = schema.parse(await load()),
          updated = Date.now()
        validateSource()
        if (version === (this.versions.get(source) ?? 0)) {
          this.db
            .prepare(
              'INSERT OR REPLACE INTO forge_work_cache(key,source,value,updated) VALUES(?,?,?,?)',
            )
            .run(key, source, JSON.stringify(result), updated)
          this.db
            .prepare(
              'DELETE FROM forge_work_cache WHERE key IN (SELECT key FROM forge_work_cache ORDER BY updated DESC LIMIT -1 OFFSET 500)',
            )
            .run()
        }
        return {
          ...result,
          cachedAt: new Date(updated).toISOString(),
          stale: version !== (this.versions.get(source) ?? 0),
        }
      } catch (error) {
        validateSource()
        if (cached)
          return {
            ...cached,
            cachedAt: new Date(row!.updated).toISOString(),
            stale: true,
            refreshError: errorMessage(error),
          }
        throw error
      }
    }
    if (operation === 'issues/list')
      return read(forgeIssuePageSchema, () =>
        provider.issues(query.state, query.cursor, query.query),
      )
    if (operation === 'issues/detail')
      return read(forgeIssueDetailSchema, () => provider.issue(id(), query.cursor))
    if (operation === 'pipelines/list')
      return read(forgePipelinePageSchema, () => provider.pipelines(query.cursor))
    if (operation === 'pipelines/detail')
      return read(forgePipelineDetailSchema, () => provider.pipeline(id(), query.cursor))
    if (operation === 'pipelines/definitions')
      return forgeDefinitionsSchema.parse(await provider.definitions(query.cursor))
    throw new HttpError(404, 'Source control operation not found')
  }
}
