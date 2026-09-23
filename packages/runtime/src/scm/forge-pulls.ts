import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { dirname } from 'node:path'
import { homedir } from 'node:os'
import { Schema } from 'effect'
import {
  forgeRepositorySchema,
  pullLineCommentSchema,
  type ForgeRepositoryPage,
  type PullAction,
  type PullCreate,
} from '@dovo/protocol'
import { PullRequests } from './pulls.js'
import { GiteaForge } from './forge-gitea.js'
import { BitbucketForge } from './forge-bitbucket.js'
import { AzureForge } from './forge-azure.js'
import { connectionHttp } from './forge-connections.js'
import type { ForgeConnections } from './forge-connections.js'
import type { ForgeAdapter } from './forge-types.js'
import type { GitService } from './git.js'
import type { WorkspaceStore } from '../storage/workspace.js'
import { HttpError } from '../errors.js'
export class ForgePullRequests {
  private github: PullRequests
  private githubTargets = new Map<string, PullRequests>()
  constructor(
    private git: GitService,
    private connections: ForgeConnections,
    private store: WorkspaceStore,
  ) {
    this.github = new PullRequests(git)
  }
  private async binding(cwd: string) {
    const exact = this.store.get().repositories.find((repo) => repo.path === cwd)
    if (exact) return exact.forge
    const common = (
      await this.git.command(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim()
    return this.store.get().repositories.find((repo) => repo.path === dirname(common))?.forge
  }
  adapter(connectionId: string, repository: string, cwd?: string): ForgeAdapter {
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
      (repository.split('/').length !== 2 ||
        repository
          .split('/')
          .some(
            (part) => !part.trim() || part === '.' || part === '..' || /[\p{Cc}?#\\]/u.test(part),
          ))
    )
      throw new HttpError(400, 'Enter owner/repository, or project/repository for Azure DevOps')
    const http = connectionHttp(this.connections, connection, directory)
    if (connection.provider === 'bitbucket') return new BitbucketForge(http, repository)
    if (connection.provider === 'azure-devops') return new AzureForge(http, repository)
    if (connection.provider === 'forgejo' || connection.provider === 'gitea')
      return new GiteaForge(http, repository)
    const host = new URL(connection.baseUrl).hostname
    const github = this.githubTarget(
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
              }
            : undefined,
        ),
      ) as unknown
    }
    const repoSchema = mutableStruct({
      id: Schema.Number.pipe(Schema.finite()),
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
      list: (state, page) => github.list(directory, state, page),
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
  private async target(cwd: string) {
    const binding = await this.binding(cwd)
    return binding ? this.adapter(binding.connectionId, binding.repository, cwd) : undefined
  }
  async identity(cwd: string, refresh = false) {
    const binding = await this.binding(cwd)
    if (binding) {
      const connection = await this.connections.reconcileCli(binding.connectionId, cwd)
      const account =
        connection.provider === 'github'
          ? await this.githubTarget(
              connection.id,
              connection.revision,
              new URL(connection.baseUrl).hostname,
              binding.repository,
              connection.cliProfile,
            ).identity(cwd, refresh)
          : undefined
      return JSON.stringify([connection.id, connection.revision, binding.repository, account])
    }
    return this.github.identity(cwd, refresh)
  }
  // PullCache calls this through its structural Pick<PullRequests, ...> contract.
  // fallow-ignore-next-line unused-class-member
  async list(cwd: string, state: 'open' | 'closed' | 'all', page: number) {
    return (await this.target(cwd))?.list(state, page) ?? this.github.list(cwd, state, page)
  }
  async detail(cwd: string, number: number) {
    const binding = await this.binding(cwd)
    const detail = binding
      ? await this.adapter(binding.connectionId, binding.repository, cwd).detail(number)
      : await this.github.detail(cwd, number)
    if (binding) detail.pull.connectionId = binding.connectionId
    return detail
  }
  async comment(cwd: string, value: unknown) {
    const input = decode(pullLineCommentSchema, value)
    return (await this.target(cwd))?.comment(input) ?? this.github.comment(cwd, input)
  }
  async create(cwd: string, input: PullCreate) {
    return (await this.target(cwd))?.create(input) ?? this.github.create(cwd, input)
  }
  async createOptions(cwd: string) {
    const binding = await this.binding(cwd)
    const provider = binding ? this.connections.get(binding.connectionId).provider : 'github'
    return {
      provider,
      draft: provider === 'github' || provider === 'bitbucket' || provider === 'azure-devops',
    }
  }
  async act(cwd: string, input: PullAction) {
    return (await this.target(cwd))?.act(input) ?? this.github.act(cwd, input)
  }
}
