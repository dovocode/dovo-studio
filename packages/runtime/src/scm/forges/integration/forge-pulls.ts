import { isDeepStrictEqual } from 'node:util'
import { verifySourceContext, guardSource, type SourceContext } from './source-context.js'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { Schema } from 'effect'
import {
  forgeRepositorySchema,
  gitRemoteIdentity,
  forgePullTarget,
  forgeLabels,
  pullLineCommentSchema,
  type ForgeRepositoryPage,
  type PullAction,
  type PullDetailSection,
  type PullCreate,
} from '@dovo/protocol'
import { PullRequests } from '../../pulls/pulls.js'
import { pullAttributes } from '../../pulls/pull-attributes.js'
import { GiteaForge } from '../providers/forge-gitea.js'
import { GitLabForge } from '../providers/forge-gitlab.js'
import { BitbucketForge } from '../providers/forge-bitbucket.js'
import { AzureForge } from '../providers/forge-azure.js'
import { connectionHttp } from './forge-connections.js'
import type { ForgeConnections } from './forge-connections.js'
import type { ForgeAdapter } from './forge-types.js'
import type { GitService } from '../../git/git.js'
import type { WorkspaceStore } from '../../../storage/workspace.js'
import { HttpError } from '../../../errors.js'
import { retrievalFresh, retrievalLocal } from '../../../retrieval/context.js'
import {
  pullPeerRequestSchema,
  pullOperationWrites,
  type PullCommunication,
  type PullOperation,
} from '../../../retrieval/pulls.js'
import {
  pullActionResultSchema,
  pullDetailSchema,
  pullPageSchema,
  pullStackSchema,
} from '@dovo/protocol'
export class ForgePullRequests {
  communication?: PullCommunication
  private githubTargets = new Map<string, PullRequests>()
  constructor(
    private git: GitService,
    private connections: ForgeConnections,
    private store: WorkspaceStore,
  ) {}
  private communicate<T, I>(
    scope: SourceContext,
    operation: PullOperation,
    schema: Schema.Codec<T, I>,
    load: () => Promise<T>,
  ): Promise<T> {
    scope.validate()
    const execute = this.communication
      ? this.communication.pull(
          {
            provider: scope.provider,
            instance: scope.connection?.baseUrl.replace(/\/$/, '') ?? `https://${scope.host}`,
            repository: scope.repository,
            readerIdentity: scope.readerIdentity,
          },
          operation,
          schema,
          load,
        )
      : load()
    return execute.then((value) => {
      scope.validate()
      return value
    })
  }
  private operation<T, I>(
    cwd: string,
    scope: SourceContext,
    operation: PullOperation,
    schema: Schema.Codec<T, I>,
  ) {
    return this.communicate(scope, operation, schema, async () =>
      decode(schema, await this.executePeer(scope, operation, cwd)),
    )
  }
  /** The paired executor selects its own credentials and checks the account before any operation.
   * No paths, credentials, commands or local task IDs are accepted from the caller. */
  async servePeer(input: unknown, runtimeId: string) {
    const request = decode(pullPeerRequestSchema, input)
    if (request.owner !== runtimeId)
      throw new HttpError(409, 'This is not the selected PR computer. Check its pairing.')
    const { provider, instance, repository, readerIdentity } = request.scope
    const connections = this.connections
      .list()
      .filter(
        (connection) =>
          connection.provider === provider && connection.baseUrl.replace(/\/$/, '') === instance,
      )
    const prepare = async (connection?: (typeof connections)[number]) => {
      const validate = () => {
        if (connection && this.connections.get(connection.id).revision !== connection.revision)
          throw new HttpError(409, 'The PR account changed. Refresh before continuing.')
      }
      return verifySourceContext(
        this.git,
        this.connections,
        homedir(),
        repository,
        new URL(instance).hostname,
        connection,
        ['peer', provider, instance, repository],
        validate,
      )
    }
    let scope: SourceContext | undefined
    let verificationError: unknown
    for (const connection of connections) {
      try {
        const candidate = await prepare(connection)
        if (candidate.readerIdentity === readerIdentity) {
          scope = candidate
          break
        }
      } catch (error) {
        // An unavailable credential cannot authorize an operation or a cached response.
        verificationError = error
      }
    }
    if (!scope && provider === 'github') {
      try {
        const candidate = await prepare()
        if (candidate.readerIdentity === readerIdentity) scope = candidate
      } catch (error) {
        verificationError = error
      }
    }
    if (!scope) {
      if (verificationError !== undefined) throw verificationError
      throw new HttpError(
        409,
        'No matching PR account on the preferred computer. Connect the same account there.',
      )
    }
    const verified = scope
    const load = () =>
      retrievalLocal(() =>
        retrievalFresh(request.fresh === true, () => this.executePeer(verified, request.operation)),
      )
    const value = this.communication
      ? await this.communication.servePull(
          request.scope,
          request.operation,
          Schema.Unknown,
          load,
          request.fresh === true,
        )
      : await load()
    if (!pullOperationWrites(request.operation)) verified.validate()
    return { host: runtimeId, value }
  }
  private async executePeer(scope: SourceContext, operation: PullOperation, cwd = homedir()) {
    const github = () => this.scopedGithub(scope)
    const adapter = () => this.scopedAdapter(scope, cwd)
    switch (operation.kind) {
      case 'list':
        return (
          adapter()?.list(operation.state, operation.page, operation.background) ??
          github().list(cwd, operation.state, operation.page, operation.background)
        )
      case 'detail':
        return adapter()?.detail(operation.number) ?? github().detail(cwd, operation.number)
      case 'section':
        return scope.provider === 'github'
          ? github().section(cwd, operation.number, operation.section)
          : adapter()!.detail(operation.number)
      case 'status':
        return scope.provider === 'github'
          ? github().status(cwd, operation.number, operation.background)
          : adapter()!.detail(operation.number)
      case 'feedback':
        return scope.provider === 'github'
          ? github().feedback(cwd, operation.number)
          : adapter()!.detail(operation.number)
      case 'nativeStack':
        return scope.provider === 'github'
          ? ((await github().nativeStack(cwd, operation.number, operation.stackNumber)) ?? null)
          : null
      case 'act': {
        const input = {
          ...operation.input,
          expectedDestination: scope.destination,
          expectedReaderIdentity: scope.readerIdentity,
        }
        return adapter()?.act(input) ?? github().act(cwd, input)
      }
      case 'create': {
        const input = {
          ...operation.input,
          expectedDestination: scope.destination,
          expectedReaderIdentity: scope.readerIdentity,
        }
        return adapter()?.create(input) ?? github().create(cwd, input)
      }
      case 'comment': {
        const input = {
          ...operation.input,
          expectedDestination: scope.destination,
          expectedReaderIdentity: scope.readerIdentity,
        }
        return adapter()?.comment(input) ?? github().comment(cwd, input)
      }
    }
  }
  /** Prefer a project binding, or require the caller to choose between unrelated accounts. */
  urlTarget(url: string, connectionId?: string) {
    const target = forgePullTarget(url)
    if (!target) throw new HttpError(400, 'Enter a supported public pull request URL')
    const label = forgeLabels[target.provider]
    const host = new URL(target.url).hostname
    const repository = new URL(target.url).pathname
      .replace(/\/(?:-\/merge_requests|pull)\/\d+$/, '')
      .replace(/^\//, '')
    const candidates = this.connections
      .list()
      .filter((c) => c.provider === target.provider && new URL(c.baseUrl).hostname === host)
    const projects = this.store
      .get()
      .repositories.filter(
        (repo) =>
          repo.forge &&
          candidates.some((c) => c.id === repo.forge?.connectionId) &&
          repo.forge.repository.toLowerCase() === repository.toLowerCase(),
      )
    // A linked PR can belong to a different repository. Retain the thread project's
    // account (including its gh environment) rather than falling back to the home directory.
    // Multiple originating projects remain ambiguous and require an explicit account.
    const linkedRepositoryIds = new Set(
      this.store
        .get()
        .tasks.filter((task) =>
          [task.pullRequest, ...(task.linkedPullRequests ?? [])].some(
            (pull) => pull && forgePullTarget(pull.url)?.url === target.url,
          ),
        )
        .map((task) => task.repositoryId),
    )
    const linkedProject =
      target.provider === 'github' && linkedRepositoryIds.size === 1
        ? this.store
            .get()
            .repositories.find((repo) => linkedRepositoryIds.has(repo.id) && !repo.kind)
        : undefined
    const origin =
      linkedProject &&
      (!linkedProject.forge ||
        candidates.some((candidate) => candidate.id === linkedProject.forge?.connectionId))
        ? linkedProject
        : undefined
    const bound = origin
      ? [origin.forge?.connectionId]
      : [...new Set(projects.map((repo) => repo.forge!.connectionId))]
    const choices = connectionId
      ? candidates.filter((c) => c.id === connectionId)
      : candidates.filter((c) => (bound.length ? bound.includes(c.id) : true))
    if (connectionId && !choices.length)
      throw new HttpError(400, `Choose a ${label} account configured for this host.`)
    if (choices.length > 1)
      throw new HttpError(
        409,
        `Multiple ${label} accounts match this PR. Choose a source control connection and refresh.`,
      )
    const selected = choices[0]
    if (!selected && target.provider !== 'github')
      throw new HttpError(
        409,
        `Connect a ${label} account on this runtime to open this pull request.`,
      )
    const project =
      (!connectionId && origin) ||
      projects.find((repo) => repo.forge?.connectionId === selected?.id)
    const cwd = project?.path ?? homedir()
    const prepare = async (refresh = false) => {
      const validate = () => {
        if (selected && this.connections.get(selected.id).revision !== selected.revision)
          throw new HttpError(
            409,
            'This source control account changed. Refresh before continuing.',
          )
        if (
          project &&
          !isDeepStrictEqual(
            (() => {
              const current = this.store.get().repositories.find((repo) => repo.id === project.id)
              return current && { path: current.path, forge: current.forge }
            })(),
            { path: project.path, forge: project.forge },
          )
        )
          throw new HttpError(409, 'This project source changed. Refresh before continuing.')
      }
      return verifySourceContext(
        this.git,
        this.connections,
        cwd,
        repository,
        host,
        selected,
        ['url', target.url, project?.id, project?.forge],
        validate,
        refresh,
      )
    }
    return {
      identity: async (refresh: boolean) => (await prepare(refresh)).destination,
      sourceIdentity: async (refresh = false) => {
        const { readerIdentity, destination } = await prepare(refresh)
        return { readerIdentity, destination }
      },
      guard: async (input: { expectedReaderIdentity?: string; expectedDestination?: string }) =>
        guardSource(await prepare(), input),
      detail: async (number: number, expectedDestination?: string) => {
        const scope = await prepare()
        guardSource(scope, { expectedDestination })
        return this.tagDetail(
          await this.operation(cwd, scope, { kind: 'detail', number }, pullDetailSchema),
          scope,
        )
      },
      status: async (number: number, background = false, expectedDestination?: string) => {
        const scope = await prepare()
        guardSource(scope, { expectedDestination })
        return this.tagDetail(
          await this.operation(
            cwd,
            scope,
            { kind: 'status', number, background },
            pullDetailSchema,
          ),
          scope,
        )
      },
      section: async (number: number, section: PullDetailSection, expectedDestination?: string) => {
        const scope = await prepare()
        guardSource(scope, { expectedDestination })
        return this.tagDetail(
          await this.operation(cwd, scope, { kind: 'section', number, section }, pullDetailSchema),
          scope,
        )
      },
      act: async (input: PullAction) => {
        const scope = await prepare()
        guardSource(scope, input)
        return this.operation(cwd, scope, { kind: 'act', input }, pullActionResultSchema)
      },
      comment: async (input: typeof pullLineCommentSchema.Type) => {
        const scope = await prepare()
        guardSource(scope, input)
        return this.operation(
          cwd,
          scope,
          { kind: 'comment', input },
          mutableStruct({ url: Schema.String }),
        )
      },
    }
  }
  private async boundRepository(cwd: string) {
    const exact = this.store.get().repositories.find((repo) => repo.path === cwd)
    if (exact) return exact
    const common = (
      await this.git.command(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim()
    return this.store.get().repositories.find((repo) => repo.path === dirname(common))
  }
  private async binding(cwd: string) {
    return (await this.boundRepository(cwd))?.forge
  }
  async githubEnvironment(cwd: string): Promise<Record<string, string>> {
    if (
      !this.store.get().repositories.some((repo) => repo.path === cwd) &&
      !(await this.git.folderStatus(cwd)).initialized
    )
      return {}
    const binding = await this.binding(cwd)
    if (!binding) return {}
    const connection = this.connections.get(binding.connectionId)
    if (connection.provider !== 'github') return {}
    const token = await this.connections.githubToken(connection.id, cwd)
    return {
      ...connection.cliEnv,
      GH_HOST: new URL(connection.baseUrl).hostname,
      ...(token
        ? {
            GH_TOKEN: token,
            GH_ENTERPRISE_TOKEN: token,
            GITHUB_TOKEN: '',
            GITHUB_ENTERPRISE_TOKEN: '',
          }
        : {}),
    }
  }
  adapter(
    connectionId: string,
    repository: string,
    cwd?: string,
    scope?: SourceContext,
  ): ForgeAdapter {
    const connection = this.connections.get(connectionId)
    const directory =
      cwd ??
      this.store
        .get()
        .repositories.find(
          (repo) =>
            repo.forge?.connectionId === connectionId && repo.forge.repository === repository,
        )?.path ??
      homedir()
    if (
      repository &&
      ((connection.provider === 'gitlab'
        ? repository.split('/').length < 2
        : repository.split('/').length !== 2) ||
        repository
          .split('/')
          .some(
            (part) => !part.trim() || part === '.' || part === '..' || /[\p{Cc}?#\\]/u.test(part),
          ))
    )
      throw new HttpError(400, 'Enter owner/repository, or project/repository for Azure DevOps')
    const http = scope?.http ?? connectionHttp(this.connections, connection, directory)
    if (connection.provider === 'gitlab') return new GitLabForge(http, repository)
    if (connection.provider === 'bitbucket') return new BitbucketForge(http, repository)
    if (connection.provider === 'azure-devops') return new AzureForge(http, repository)
    if (connection.provider === 'forgejo' || connection.provider === 'gitea')
      return new GiteaForge(http, repository)
    const host = new URL(connection.baseUrl).hostname
    const github = scope
      ? this.scopedGithub(scope)
      : this.githubTarget(
          connection.id,
          connection.revision,
          host,
          repository,
          connection.cliProfile,
        )
    const api = async (path: string) => {
      if (this.connections.get(connection.id).revision !== connection.revision)
        throw new HttpError(409, 'This source control account changed. Refresh before continuing.')
      const token = await this.connections.githubToken(connection.id, directory)
      return JSON.parse(
        await this.git.githubAccount(
          ['api', '--hostname', host, path],
          undefined,
          directory,
          token
            ? {
                host,
                token,
                ...(connection.cliEnv ? { env: connection.cliEnv } : {}),
              }
            : undefined,
        ),
      ) as unknown
    }
    const repoSchema = mutableStruct({
      id: Schema.Number.pipe(Schema.check(Schema.isFinite())),
      name: Schema.String,
      full_name: Schema.String,
      html_url: Schema.String,
      clone_url: Schema.String,
      default_branch: Schema.String,
    })
    const normalize = (value: unknown) => {
      const repo = decode(repoSchema, value)
      return decode(forgeRepositorySchema, {
        id: String(repo.id),
        name: repo.name,
        fullName: repo.full_name,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        defaultBranch: repo.default_branch,
      })
    }
    return {
      repository: async () =>
        normalize(await api(`repos/${repository.split('/').map(encodeURIComponent).join('/')}`)),
      repositories: async (page): Promise<ForgeRepositoryPage> => {
        const repos = decode(
          mutableArray(Schema.Unknown),
          await api(`user/repos?sort=updated&per_page=50&page=${page}`),
        )
        return {
          repositories: repos.map(normalize),
          page,
          hasMore: repos.length === 50,
        }
      },
      list: (state, page, background) => github.list(directory, state, page, background),
      detail: (number) => github.detail(directory, number),
      comment: (input) => github.comment(directory, input),
      create: (input) => github.create(directory, input),
      act: (input) => github.act(directory, input),
    }
  }
  private githubTarget(
    id: string,
    revision: string,
    host: string,
    repository: string,
    profile?: string,
  ) {
    const key = JSON.stringify([id, revision, host, repository, profile])
    const existing = this.githubTargets.get(key)
    if (existing) return existing
    const result = new PullRequests(this.git, {
      host,
      repository,
      profile,
      env: this.connections.get(id).cliEnv,
      onUnauthorized: () => this.connections.forgetCredentials(id),
      token: (cwd) => {
        if (this.connections.get(id).revision !== revision)
          throw new HttpError(
            409,
            'This source control account changed. Refresh before continuing.',
          )
        return this.connections.githubToken(id, cwd)
      },
    })
    if (this.githubTargets.size >= 100) this.githubTargets.clear()
    this.githubTargets.set(key, result)
    return result
  }
  private scopedGithub(scope: SourceContext) {
    const credential = scope.github
    if (!credential)
      throw new HttpError(409, 'GitHub credentials are unavailable. Refresh before continuing.')
    return new PullRequests(this.git, {
      host: scope.host,
      repository: scope.repository,
      viewerLogin: scope.viewerLogin,
      env: credential.env,
      token: async () => {
        scope.validate()
        return credential.token
      },
      onUnauthorized: credential.onUnauthorized,
      validate: scope.validate,
    })
  }
  async sourceContext(cwd: string, refresh = false): Promise<SourceContext> {
    const repository = await this.boundRepository(cwd)
    let selected = repository?.forge
    const savedBinding = selected
    if (!selected) {
      const remote = (await this.git.command(cwd, ['remote', 'get-url', 'origin'])).trim()
      const identity = gitRemoteIdentity(remote)
      if (!identity)
        throw new HttpError(
          409,
          'Configure a source control remote and select its provider account in project settings.',
        )
      const candidates = this.connections.list().flatMap((connection) => {
        const base = new URL(
          connection.provider === 'bitbucket' ? 'https://bitbucket.org' : connection.baseUrl,
        )
        const prefix = `${base.host}${base.pathname}`.replace(/\/$/, '') + '/'
        return identity.startsWith(prefix)
          ? [
              {
                connectionId: connection.id,
                repository:
                  connection.provider === 'azure-devops'
                    ? identity.slice(prefix.length).replace('/_git/', '/')
                    : identity.slice(prefix.length),
              },
            ]
          : []
      })
      if (candidates.length > 1)
        throw new HttpError(
          409,
          'Multiple source control accounts match this remote. Select an account in project settings.',
        )
      if (candidates[0]) selected = candidates[0]
      else if (!identity.startsWith('github.com/'))
        throw new HttpError(
          409,
          'Connect this remote’s source control provider and select its account in project settings.',
        )
    }
    let connection = selected ? this.connections.get(selected.connectionId) : undefined
    if (selected && connection?.credential === 'cli') {
      this.connections.forgetCredentials(selected.connectionId)
      connection = await this.connections.reconcileCli(selected.connectionId, cwd)
    }
    const currentConnection = connection
    const validate = () => {
      // Exact project bindings are checked synchronously before each provider request.
      const exact = repository
        ? this.store.get().repositories.find((repo) => repo.id === repository.id)
        : undefined
      if (
        repository &&
        (!exact || exact.path !== repository.path || !isDeepStrictEqual(exact.forge, savedBinding))
      )
        throw new HttpError(409, 'This project source changed. Refresh before continuing.')
      if (
        currentConnection &&
        this.connections.get(currentConnection.id).revision !== currentConnection.revision
      )
        throw new HttpError(409, 'This source control account changed. Refresh before continuing.')
    }
    const remote = selected
      ? { nameWithOwner: selected.repository, url: connection!.baseUrl }
      : decode(
          mutableStruct({ nameWithOwner: Schema.String, url: Schema.String }),
          JSON.parse(await this.git.github(cwd, ['repo', 'view', '--json', 'nameWithOwner,url'])),
        )
    return verifySourceContext(
      this.git,
      this.connections,
      cwd,
      remote.nameWithOwner,
      new URL(remote.url).hostname,
      connection,
      [cwd, selected],
      validate,
      refresh,
    )
  }
  private scopedAdapter(scope: SourceContext, cwd: string) {
    return scope.connection
      ? this.adapter(scope.connection.id, scope.repository, cwd, scope)
      : undefined
  }
  private tagDetail(detail: Awaited<ReturnType<PullRequests['detail']>>, scope: SourceContext) {
    scope.validate()
    return {
      ...detail,
      destination: scope.destination,
      pull: {
        ...detail.pull,
        destination: scope.destination,
        ...(scope.connection ? { connectionId: scope.connection.id } : {}),
      },
    }
  }
  /** Cache discovery and its later load must agree before the load issues provider reads. */
  forDestination(destination: string) {
    return {
      list: (cwd: string, state: 'open' | 'closed' | 'all', page: number, background = false) =>
        this.list(cwd, state, page, background, destination),
      detail: (cwd: string, number: number) => this.detail(cwd, number, destination),
      nativeStack: (cwd: string, number: number, stackNumber: number) =>
        this.nativeStack(cwd, number, stackNumber, destination),
      section: (cwd: string, number: number, section: PullDetailSection) =>
        this.section(cwd, number, section, destination),
      status: (cwd: string, number: number, background = false) =>
        this.status(cwd, number, background, destination),
      feedback: (cwd: string, number: number) => this.feedback(cwd, number, destination),
    }
  }
  async identity(cwd: string, refresh = false) {
    if (forgePullTarget(cwd)) return this.urlTarget(cwd).identity(refresh)
    return (await this.sourceContext(cwd, refresh)).destination
  }
  async sourceIdentity(cwd: string, refresh = false) {
    const { readerIdentity, destination } = await this.sourceContext(cwd, refresh)
    return { readerIdentity, destination }
  }
  async guard(
    cwd: string,
    input: { expectedDestination?: string; expectedReaderIdentity?: string; refresh?: boolean },
  ) {
    const scope = await this.sourceContext(cwd, input.refresh === true)
    guardSource(scope, input)
    return scope
  }
  async list(
    cwd: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    background = false,
    expectedDestination?: string,
  ) {
    const scope = await this.sourceContext(cwd)
    guardSource(scope, { expectedDestination })
    return this.listInContext(cwd, state, page, background, scope)
  }
  async listInContext(
    cwd: string,
    state: 'open' | 'closed' | 'all',
    page: number,
    background: boolean,
    scope: SourceContext,
  ) {
    scope.validate()
    const result = await this.operation(
      cwd,
      scope,
      { kind: 'list', state, page, background },
      pullPageSchema,
    )
    scope.validate()
    return {
      ...result,
      destination: scope.destination,
      pulls: result.pulls.map((pull) => ({ ...pull, destination: scope.destination })),
    }
  }
  async nativeStack(
    cwd: string,
    number: number,
    stackNumber: number,
    expectedDestination?: string,
  ) {
    const scope = await this.sourceContext(cwd)
    guardSource(scope, { expectedDestination })
    if (scope.provider !== 'github') return undefined
    const stack =
      (await this.operation(
        cwd,
        scope,
        { kind: 'nativeStack', number, stackNumber },
        Schema.NullOr(pullStackSchema),
      )) ?? undefined
    scope.validate()
    return stack
  }
  async status(cwd: string, number: number, background = false, expectedDestination?: string) {
    if (forgePullTarget(cwd))
      return this.urlTarget(cwd).status(number, background, expectedDestination)
    const scope = await this.sourceContext(cwd)
    guardSource(scope, { expectedDestination })
    return this.tagDetail(
      await this.operation(cwd, scope, { kind: 'status', number, background }, pullDetailSchema),
      scope,
    )
  }
  async detail(cwd: string, number: number, expectedDestination?: string) {
    if (forgePullTarget(cwd)) return this.urlTarget(cwd).detail(number, expectedDestination)
    const scope = await this.sourceContext(cwd)
    guardSource(scope, { expectedDestination })
    const detail = await this.operation(cwd, scope, { kind: 'detail', number }, pullDetailSchema)
    return this.tagDetail(await pullAttributes(this.git, cwd, detail), scope)
  }
  async section(
    cwd: string,
    number: number,
    section: PullDetailSection,
    expectedDestination?: string,
  ) {
    if (forgePullTarget(cwd))
      return this.urlTarget(cwd).section(number, section, expectedDestination)
    const scope = await this.sourceContext(cwd)
    guardSource(scope, { expectedDestination })
    return this.sectionInContext(cwd, number, section, scope)
  }
  /** The request already verified this credential; still validate the binding before dispatch. */
  async sectionInContext(
    cwd: string,
    number: number,
    section: PullDetailSection,
    scope: SourceContext,
  ) {
    scope.validate()
    const detail = await this.operation(
      cwd,
      scope,
      { kind: 'section', number, section },
      pullDetailSchema,
    )
    return this.tagDetail(
      section === 'changes' ? await pullAttributes(this.git, cwd, detail) : detail,
      scope,
    )
  }
  async feedback(cwd: string, number: number, expectedDestination?: string) {
    const scope = await this.sourceContext(cwd)
    guardSource(scope, { expectedDestination })
    return this.tagDetail(
      await this.operation(cwd, scope, { kind: 'feedback', number }, pullDetailSchema),
      scope,
    )
  }
  async comment(cwd: string, value: unknown) {
    const input = decode(pullLineCommentSchema, value)
    const scope = await this.guard(cwd, input)
    return this.operation(
      cwd,
      scope,
      { kind: 'comment', input },
      mutableStruct({ url: Schema.String }),
    )
  }
  async create(cwd: string, input: PullCreate) {
    const scope = await this.guard(cwd, input)
    return this.operation(cwd, scope, { kind: 'create', input }, pullActionResultSchema)
  }
  async createOptions(cwd: string) {
    const scope = await this.sourceContext(cwd)
    return {
      provider: scope.provider,
      destination: scope.destination,
      draft: ['github', 'gitlab', 'bitbucket', 'azure-devops'].includes(scope.provider),
    }
  }
  async act(cwd: string, input: PullAction) {
    const scope = await this.guard(cwd, input)
    return this.operation(cwd, scope, { kind: 'act', input }, pullActionResultSchema)
  }
}
