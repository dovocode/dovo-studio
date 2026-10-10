import { mutableStruct } from '@dovo/protocol'
import { decodeResult, urlSchema, decode, maxValue, minValue } from '@dovo/protocol'
import { homedir } from 'node:os'
import { isDeepStrictEqual } from 'node:util'
import {
  JiraWork,
  jiraIssuePage,
  jiraOffset,
  type JiraVerification,
} from '../forges/providers/jira.js'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import { runClientEffect } from '@dovo/client-runtime'
import {
  forgeIssueActionSchema,
  forgeIssueCreateSchema,
  forgePipelineActionSchema,
  forgeWorkQuerySchema,
  jiraIssueFilterKey,
  hasJiraIssueFilters,
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgeIssueDetailSchema,
  forgePipelinePageSchema,
  forgePipelineDetailSchema,
  forgeDefinitionsSchema,
  forgeWorkResultSchema,
  forgeIssueSchema,
  mutableArray,
  type CommandSettings,
} from '@dovo/protocol'
import { connectionHttp } from '../forges/integration/forge-connections.js'
import { GitForgeWork } from './forge-work-git.js'
import { AzureForgeWork } from './forge-work-azure.js'
import { BitbucketForgeWork } from './forge-work-bitbucket.js'
import type { ForgeWorkProvider } from './forge-work-types.js'
import type { ForgeConnections } from '../forges/integration/forge-connections.js'
import type { ForgePullRequests } from '../forges/integration/forge-pulls.js'
import type { GitService } from '../git/git.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import { HttpError, errorMessage } from '../../errors.js'
import type { runForgeCli } from '../forges/integration/forge-cli.js'
import { ForgeWorkCache } from './cache.js'
/** A verified Jira account and project serve requests for this long; refresh rechecks. */
const JIRA_VERIFICATION_TTL = 600_000
/** Jira pages are slices of one prefix read; keep at least two pages per read. */
const JIRA_PREFIX_MINIMUM = 61
const jiraPrefixSchema = mutableStruct({
  items: mutableArray(forgeIssueSchema),
  limit: Schema.Number,
  cachedAt: Schema.optional(Schema.String),
  stale: Schema.optional(Schema.Boolean),
  refreshError: Schema.optional(Schema.String),
})
export class ForgeWork {
  private cache: ForgeWorkCache
  private jira = new Map<string, { expires: number; state: JiraVerification }>()
  constructor(
    db: Database.Database,
    private store: WorkspaceStore,
    private git: GitService,
    private forges: ForgeConnections,
    private pulls: ForgePullRequests,
    private commands: () => CommandSettings,
    private jiraRun?: typeof runForgeCli,
  ) {
    this.cache = new ForgeWorkCache(db)
  }
  private async target(repositoryId: string): Promise<{
    cwd: string
    provider?: ForgeWorkProvider
  }> {
    const repo = this.store.get().repositories.find((v) => v.id === repositoryId)
    if (!repo) throw new HttpError(404, 'Project not found')
    if (repo.kind) throw new HttpError(400, 'This project does not use Git')
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
            // Shares the account budget and token cache with pull request reads.
            const result = await this.git.githubAccount(
              [
                'api',
                '--hostname',
                host,
                path,
                '--method',
                options?.method ?? 'GET',
                ...(options?.body === undefined ? [] : ['--input', '-']),
              ],
              { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
              repo.path,
              token
                ? { host, token, ...(connection?.cliEnv ? { env: connection.cliEnv } : {}) }
                : undefined,
              false,
              options?.body === undefined ? undefined : JSON.stringify(options.body),
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
    if (decode(forgeWorkQuerySchema, input).jiraFilters !== undefined)
      throw new HttpError(400, 'Jira filters require a Jira issue source')
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
    const executable = this.commands().acli
    const provider = new JiraWork(executable, selected, this.jiraRun, cwd, validateSource)
    // The CLI has one active account; one verification serves every request for a site and
    // project until it expires, an explicit refresh asks again, or the check fails.
    const key = JSON.stringify([executable, new URL(selected.site).origin, selected.project])
    const verified = this.jira.get(key)
    if (verified && verified.expires > Date.now() && !decode(forgeWorkQuerySchema, input).refresh)
      provider.adopt(verified.state)
    else {
      const state = provider.verification()
      const entry = { expires: Date.now() + JIRA_VERIFICATION_TTL, state }
      this.jira.set(key, entry)
      void state.verified.catch(() => {
        if (this.jira.get(key) === entry) this.jira.delete(key)
      })
    }
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
      Schema.StructWithRest(
        Schema.Struct(
          mutableStruct({
            id: Schema.optional(maxValue(Schema.String, 300)),
            type: Schema.optional(maxValue(Schema.String, 100)),
            area: Schema.optional(Schema.Literals(['issues', 'pipelines'])),
          }).fields,
        ),
        [Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))],
      ),
      input,
    )
    const query = decode(forgeWorkQuerySchema, input)
    if (query.jiraFilters !== undefined && operation !== 'issues/list')
      throw new HttpError(400, 'Jira filters are only supported for issue lists')
    const filterKey = jiraIssueFilterKey(query.jiraFilters)
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
    if (operation === 'issues/list' && provider instanceof JiraWork) {
      // ACLI has no page token: every page is a slice of one ordered prefix. Cache the prefix
      // per state, search and filters so later pages do not read the earlier rows again.
      const offset = jiraOffset(query.cursor)
      const required = Math.max(offset + 31, JIRA_PREFIX_MINIMUM)
      const prefixKey = JSON.stringify([
        source,
        'issues/prefix',
        query.state,
        query.query,
        ...(hasJiraIssueFilters(query.jiraFilters) ? [filterKey] : []),
      ])
      const known = this.cache.peek(prefixKey, jiraPrefixSchema)
      const limit = Math.max(required, known?.value.limit ?? 0)
      const prefix = await runClientEffect(
        this.cache.readEffect({
          key: prefixKey,
          source,
          schema: jiraPrefixSchema,
          refresh: query.refresh || (known?.value.limit ?? 0) < required,
          load: async (): Promise<typeof jiraPrefixSchema.Type> => ({
            items: await provider.issueRows(query.state, query.query, limit, query.jiraFilters),
            limit,
          }),
          validateSource,
        }),
      )
      return decode(forgeIssuePageSchema, {
        ...jiraIssuePage(prefix.items, offset),
        cachedAt: prefix.cachedAt,
        stale: prefix.stale,
        refreshError: prefix.refreshError,
      })
    }
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
