import { mutableStruct } from '@dovo/protocol'
import { decodeResult, decode, maxValue, minValue } from '@dovo/protocol'
import { homedir } from 'node:os'
import {
  guardSource,
  opaqueIdentity,
  type SourceContext,
} from '../forges/integration/source-context.js'
import { JiraWork, jiraIssuePage, jiraOffset } from '../forges/providers/jira.js'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import { runClientEffect } from '@dovo/client-runtime'
import {
  forgeIssueActionSchema,
  forgeIssueCreateSchema,
  forgePipelineActionSchema,
  forgeWorkQuerySchema,
  jiraIssueFilterKey,
  jiraBoardsSchema,
  jiraSprintsSchema,
  jiraNumericId,
  hasJiraIssueFilters,
  forgeWorkOptionsSchema,
  forgeIssuePageSchema,
  forgeIssueDetailSchema,
  forgePipelinePageSchema,
  forgePipelineDetailSchema,
  pipelineRevision,
  forgeDefinitionsSchema,
  forgeWorkResultSchema,
  forgeIssueSchema,
  mutableArray,
  type CommandSettings,
} from '@dovo/protocol'
import { GitForgeWork } from './forge-work-git.js'
import { AzureForgeWork } from './forge-work-azure.js'
import { BitbucketForgeWork } from './forge-work-bitbucket.js'
import { GitLabForgeWork } from './forge-work-gitlab.js'
import type { ForgeWorkProvider } from './forge-work-types.js'
import type { ForgeConnections } from '../forges/integration/forge-connections.js'
import type { ForgePullRequests } from '../forges/integration/forge-pulls.js'
import type { GitService } from '../git/git.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import { HttpError, errorMessage } from '../../errors.js'
import type { runForgeCli } from '../forges/integration/forge-cli.js'
import { ForgeWorkCache } from './cache.js'
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
  constructor(
    db: Database.Database,
    private store: WorkspaceStore,
    private git: GitService,
    _forges: ForgeConnections,
    private pulls: ForgePullRequests,
    private commands: () => CommandSettings,
    private jiraRun?: typeof runForgeCli,
  ) {
    this.cache = new ForgeWorkCache(db)
  }
  private async target(
    repositoryId: string,
    refresh = false,
  ): Promise<{ cwd: string; provider?: ForgeWorkProvider; scope?: SourceContext }> {
    const repo = this.store.get().repositories.find((v) => v.id === repositoryId)
    if (!repo) throw new HttpError(404, 'Project not found')
    if (repo.kind) throw new HttpError(400, 'This project does not use Git')
    let scope: SourceContext
    try {
      scope = await this.pulls.sourceContext(repo.path, refresh)
    } catch (error) {
      const stderr = decodeResult(mutableStruct({ stderr: Schema.String }), error)
      const diagnostic = stderr.success ? stderr.data.stderr : errorMessage(error)
      if (
        !repo.forge &&
        /^(?:Command failed: [^\r\n]+\r?\n)?no git remotes found\s*$/i.test(diagnostic.trim())
      )
        return { cwd: repo.path }
      throw error
    }
    if (scope.provider !== 'github') {
      if (!scope.http)
        throw new HttpError(409, 'Provider credentials unavailable. Refresh before continuing.')
      return {
        cwd: repo.path,
        scope,
        provider:
          scope.provider === 'azure-devops'
            ? new AzureForgeWork(scope.http, scope.repository)
            : scope.provider === 'gitlab'
              ? new GitLabForgeWork(scope.http, scope.repository)
              : scope.provider === 'bitbucket'
                ? new BitbucketForgeWork(scope.http, scope.repository)
                : new GitForgeWork(scope.http, scope.provider, scope.repository),
      }
    }
    return {
      cwd: repo.path,
      scope,
      provider: new GitForgeWork(
        {
          json: async (path, options) => {
            scope.validate()
            const result = await this.git.githubAccount(
              [
                'api',
                '--hostname',
                scope.host,
                path,
                '--method',
                options?.method ?? 'GET',
                ...(options?.body === undefined ? [] : ['--input', '-']),
              ],
              { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
              repo.path,
              scope.github,
              false,
              options?.body === undefined ? undefined : JSON.stringify(options.body),
            )
            return result.trim() ? (JSON.parse(result) as unknown) : null
          },
        },
        'github',
        scope.repository,
      ),
    }
  }
  async request(repositoryId: string, operation: string, input: unknown) {
    const query = decode(forgeWorkQuerySchema, input)
    if (query.jiraFilters !== undefined)
      throw new HttpError(400, 'Jira filters require a Jira issue source')
    const { cwd, provider, scope } = await this.target(repositoryId, query.refresh === true)
    if (!provider || !scope) {
      if (operation === 'options')
        return decode(forgeWorkOptionsSchema, {
          provider: 'github',
          issues: false,
          pipelines: false,
          pipelineActions: [],
        })
      if (operation === 'issues/list') return decode(forgeIssuePageSchema, { items: [] })
      if (operation === 'pipelines/list') return decode(forgePipelinePageSchema, { items: [] })
      throw new HttpError(404, 'This project has no remote source.')
    }
    guardSource(scope, decode(forgeWorkQuerySchema, input))
    return this.execute(
      provider,
      cwd,
      ['repository', repositoryId],
      operation,
      input,
      scope.validate,
      scope,
    )
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
    try {
      const readerIdentity = opaqueIdentity([
        'jira',
        new URL(selected.site).origin,
        await provider.identity(),
      ])
      const identity = {
        readerIdentity,
        destination: opaqueIdentity([
          'jira',
          sourceId,
          new URL(selected.site).origin,
          selected.project,
          readerIdentity,
          executable,
          await provider.revision(),
        ]),
      }
      guardSource(identity, decode(forgeWorkQuerySchema, input))
      const result = await this.execute(
        provider,
        cwd,
        ['jira', sourceId],
        operation,
        input,
        validateSource,
        identity,
      )
      await provider.assertAccount()
      return result
    } finally {
      await provider.close()
    }
  }
  async sourceIdentityJira(sourceId: string) {
    const selected = this.store.get().jiraSources?.find((source) => source.id === sourceId)
    if (!selected) throw new HttpError(404, 'Jira source not found')
    const executable = this.commands().acli
    const provider = new JiraWork(executable, selected, this.jiraRun, homedir())
    try {
      const readerIdentity = opaqueIdentity([
        'jira',
        new URL(selected.site).origin,
        await provider.identity(),
      ])
      await provider.assertAccount()
      return {
        readerIdentity,
        destination: opaqueIdentity([
          'jira',
          sourceId,
          new URL(selected.site).origin,
          selected.project,
          readerIdentity,
          executable,
          await provider.revision(),
        ]),
      }
    } finally {
      await provider.close()
    }
  }
  private async execute(
    provider: ForgeWorkProvider,
    cwd: string,
    sourceId: string[],
    operation: string,
    input: unknown,
    validateSource: () => void,
    identity: { readerIdentity: string; destination: string },
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
    if (
      query.section &&
      ((operation !== 'issues/detail' && operation !== 'pipelines/detail') ||
        (operation === 'issues/detail' && !['overview', 'discussion'].includes(query.section)) ||
        (operation === 'pipelines/detail' &&
          !['overview', 'jobs', 'graph'].includes(query.section)))
    )
      throw new HttpError(400, 'This section is not supported for this operation')
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
      return { ...result, destination: identity.destination }
    }
    const source = JSON.stringify([sourceId, identity.destination])
    validateSource()
    if (operation === 'jira/boards' || operation === 'jira/sprints') {
      if (!(provider instanceof JiraWork)) throw new HttpError(400, 'Choose a Jira source.')
      const board = operation === 'jira/sprints' ? decode(jiraNumericId, data.id) : undefined
      const closed = query.state === 'closed'
      const common = {
        key: JSON.stringify([source, operation, board, closed]),
        source,
        refresh: query.refresh,
        retainLoad: () => provider.retain(),
        validateSource,
      }
      if (board)
        return runClientEffect(
          this.cache.readEffect({
            ...common,
            schema: jiraSprintsSchema,
            load: async () => ({
              ...(await provider.sprints(board, closed)),
              destination: identity.destination,
            }),
          }),
        )
      return runClientEffect(
        this.cache.readEffect({
          ...common,
          schema: jiraBoardsSchema,
          load: async () => ({ ...(await provider.boards()), destination: identity.destination }),
        }),
      )
    }
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
    const key = JSON.stringify([
      source,
      operation,
      data.id,
      query.state,
      query.cursor,
      query.query,
      ...(query.section ? [query.section] : []),
    ])
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
          retainLoad: () => provider.retain(),
          refresh: query.refresh || (known?.value.limit ?? 0) < required,
          load: async (): Promise<typeof jiraPrefixSchema.Type> => ({
            items: (
              await provider.issueRows(query.state, query.query, limit, query.jiraFilters)
            ).map((item) => ({ ...item, destination: identity.destination })),
            limit,
          }),
          validateSource,
        }),
      )
      return decode(forgeIssuePageSchema, {
        ...jiraIssuePage(prefix.items, offset),
        destination: identity.destination,
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
          load: async () => {
            const result = await provider.issues(query.state, query.cursor, query.query)
            return {
              ...result,
              destination: identity.destination,
              items: result.items.map((item) => ({ ...item, destination: identity.destination })),
            }
          },
          validateSource,
        }),
      )
    if (operation === 'issues/detail')
      return runClientEffect(
        this.cache.readEffect({
          key,
          source,
          schema: forgeIssueDetailSchema,
          acceptCached: query.revision
            ? (value) => value.issue.revision === query.revision
            : undefined,
          retainLoad: provider instanceof JiraWork ? () => provider.retain() : undefined,
          refresh: query.refresh,
          load: async () => {
            const result = await provider.issue(
              id(),
              query.cursor,
              query.section === 'overview' || query.section === 'discussion'
                ? query.section
                : undefined,
            )
            return {
              ...result,
              destination: identity.destination,
              issue: { ...result.issue, destination: identity.destination },
            }
          },
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
          load: async () => {
            const result = await provider.pipelines(query.cursor)
            return {
              ...result,
              destination: identity.destination,
              items: result.items.map((item) => ({ ...item, destination: identity.destination })),
            }
          },
          validateSource,
        }),
      )
    if (operation === 'pipelines/detail')
      return runClientEffect(
        this.cache.readEffect({
          key,
          source,
          schema: forgePipelineDetailSchema,
          acceptCached: query.revision
            ? (value) => pipelineRevision(value.run) === query.revision
            : undefined,
          refresh: query.refresh,
          load: async () => {
            const result = await provider.pipeline(
              id(),
              query.cursor,
              query.section === 'discussion' ? undefined : query.section,
            )
            return {
              ...result,
              destination: identity.destination,
              run: { ...result.run, destination: identity.destination },
            }
          },
          validateSource,
        }),
      )
    if (operation === 'pipelines/definitions')
      return {
        ...decode(forgeDefinitionsSchema, await provider.definitions(query.cursor)),
        destination: identity.destination,
      }
    throw new HttpError(404, 'Source control operation not found')
  }
}
