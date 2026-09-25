import { mutableStruct } from '@dovo/protocol'
import { decodeResult, urlSchema, decode, maxValue, minValue } from '@dovo/protocol'
import { homedir } from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import { JiraWork } from './jira.js'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import { runClientEffect } from '@dovo/client-runtime'
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
import { ForgeWorkCache } from './work/cache.js'
export class ForgeWork {
  private cache: ForgeWorkCache
  constructor(
    db: Database.Database,
    private store: WorkspaceStore,
    private git: GitService,
    private forges: ForgeConnections,
    private pulls: ForgePullRequests,
    private commands: () => CommandSettings,
  ) {
    this.cache = new ForgeWorkCache(db)
  }
  private async target(repositoryId: string): Promise<{
    cwd: string
    provider?: ForgeWorkProvider
  }> {
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
    let remote: {
      nameWithOwner: string
      url: string
    }
    if (repo.forge)
      remote = {
        nameWithOwner: repo.forge.repository,
        url: connection!.baseUrl,
      }
    else {
      let result: string
      try {
        result = await this.git.github(repo.path, ['repo', 'view', '--json', 'nameWithOwner,url'])
      } catch (error) {
        const stderr = decodeResult(
          mutableStruct({
            stderr: Schema.String,
          }),
          error,
        )
        const diagnostic = stderr.success ? stderr.data.stderr : errorMessage(error)
        // gh has no source to inspect for a local-only repository. Auth, network,
        // missing-directory and other Git failures must continue to surface.
        if (/^(?:Command failed: [^\r\n]+\r?\n)?no git remotes found\s*$/i.test(diagnostic.trim()))
          return {
            cwd: repo.path,
          }
        throw error
      }
      remote = decode(
        mutableStruct({
          nameWithOwner: Schema.String,
          url: urlSchema(),
        }),
        JSON.parse(result),
      )
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
        return decode(forgeWorkOptionsSchema, {
          provider: 'github',
          issues: false,
          pipelines: false,
          pipelineActions: [],
        })
      if (operation === 'issues/list')
        return decode(forgeIssuePageSchema, {
          items: [],
        })
      if (operation === 'pipelines/list')
        return decode(forgePipelinePageSchema, {
          items: [],
        })
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
    const data = decode(
      Schema.Struct(
        mutableStruct({
          id: Schema.optional(maxValue(Schema.String, 300)),
          type: Schema.optional(maxValue(Schema.String, 100)),
          area: Schema.optional(Schema.Literal('issues', 'pipelines')),
        }).fields,
        {
          key: Schema.String,
          value: Schema.Unknown,
        },
      ),
      input,
    )
    const query = decode(forgeWorkQuerySchema, input)
    const area =
      operation === 'options'
        ? (data.area ?? 'issues')
        : operation.startsWith('pipelines/')
          ? 'pipelines'
          : 'issues'
    validateSource()
    if (operation === 'options') {
      const result = decode(forgeWorkOptionsSchema, await provider.options(data.type, area))
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
    const id = () => decode(maxValue(minValue(Schema.String, 1), 300), data.id)
    if (
      operation === 'issues/create' ||
      operation === 'issues/action' ||
      operation === 'pipelines/action'
    ) {
      const result =
        operation === 'issues/create'
          ? await provider.createIssue(decode(forgeIssueCreateSchema, data))
          : operation === 'issues/action'
            ? await provider.actOnIssue(decode(forgeIssueActionSchema, data))
            : await provider.actOnPipeline(decode(forgePipelineActionSchema, data))
      await this.cache.invalidate(source)
      return decode(forgeWorkResultSchema, result)
    }
    const key = JSON.stringify([source, operation, data.id, query.state, query.cursor, query.query])
    if (operation === 'issues/list')
      return runClientEffect(
        this.cache.readEffect({
          key,
          source,
          schema: forgeIssuePageSchema,
          refresh: query.refresh,
          load: () => provider.issues(query.state, query.cursor, query.query),
          validateSource,
        }),
      )
    if (operation === 'issues/detail')
      return runClientEffect(
        this.cache.readEffect({
          key,
          source,
          schema: forgeIssueDetailSchema,
          refresh: query.refresh,
          load: () => provider.issue(id(), query.cursor),
          validateSource,
        }),
      )
    if (operation === 'pipelines/list')
      return runClientEffect(
        this.cache.readEffect({
          key,
          source,
          schema: forgePipelinePageSchema,
          refresh: query.refresh,
          load: () => provider.pipelines(query.cursor),
          validateSource,
        }),
      )
    if (operation === 'pipelines/detail')
      return runClientEffect(
        this.cache.readEffect({
          key,
          source,
          schema: forgePipelineDetailSchema,
          refresh: query.refresh,
          load: () => provider.pipeline(id(), query.cursor),
          validateSource,
        }),
      )
    if (operation === 'pipelines/definitions')
      return decode(forgeDefinitionsSchema, await provider.definitions(query.cursor))
    throw new HttpError(404, 'Source control operation not found')
  }
}
