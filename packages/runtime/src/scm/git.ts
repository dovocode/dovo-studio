import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, urlSchema } from '@dovo/protocol'
import { readFile, writeFile, stat, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Schema } from 'effect'
import { commandsSchema, REPOSITORY_CLONE_TIMEOUT_MS, type CommandSettings } from '@dovo/protocol'
import type { ChangedFile } from '@dovo/protocol'
import type { Task } from '@dovo/protocol'
import { exec, processEnvironment } from '../process.js'
import { HttpError, errorMessage } from '../errors.js'
import { repositoryPath, safeFile } from './paths.js'
export class GitService {
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private audit?: (
      cwd: string,
      args: string[],
      result?: {
        error?: string
      },
    ) => void,
    private forgeAuthorization?: (
      connectionId: string,
      remote: string,
      cwd: string,
    ) => string | Promise<string>,
  ) {}
  private async run(
    cwd: string,
    executable: string,
    args: string[],
    timeout: number,
    maxBuffer: number,
    env = processEnvironment(),
  ) {
    this.audit?.(cwd, [executable, ...args])
    try {
      const result = await exec(executable, args, {
        cwd,
        env,
        timeout,
        maxBuffer,
      })
      this.audit?.(cwd, [executable, ...args], {})
      return result.stdout
    } catch (error) {
      this.audit?.(cwd, [executable, ...args], {
        error: errorMessage(error),
      })
      throw error
    }
  }
  command(cwd: string, args: string[]) {
    return this.run(cwd, this.settings().git, args, 30000, 12 * 1024 * 1024)
  }
  async inspect(path: string) {
    const cwd = await repositoryPath(path)
    const root = (await this.command(cwd, ['rev-parse', '--show-toplevel'])).replace(/\r?\n$/, '')
    const branch = (await this.command(cwd, ['branch', '--show-current'])).trim() || 'detached HEAD'
    return {
      path: root,
      branch,
    }
  }
  async cloneGithub(
    repository: {
      name: string
      url: string
    },
    directory: string,
  ) {
    const parent = await repositoryPath(directory).catch((error: unknown) => {
      throw new HttpError(
        400,
        `Choose an existing clone parent folder on the runtime host. ${errorMessage(error)}`,
      )
    })
    const destination = join(parent, repository.name)
    try {
      // Reserve a new directory atomically. Never clone over an existing folder or symlink.
      await mkdir(destination)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        throw new HttpError(
          409,
          `Destination already exists: ${destination}. Choose another parent folder or add it using Local path.`,
        )
      throw error
    }
    try {
      const gh = "'" + this.settings().gh.replaceAll("'", "'\"'\"'") + "'"
      await this.run(
        parent,
        this.settings().git,
        [
          '-c',
          `credential.https://github.com.helper=!${gh} auth git-credential`,
          'clone',
          '--',
          repository.url,
          destination,
        ],
        REPOSITORY_CLONE_TIMEOUT_MS,
        12 * 1024 * 1024,
        {
          ...processEnvironment(),
          GIT_TERMINAL_PROMPT: '0',
          GCM_INTERACTIVE: 'never',
        },
      )
      return await this.inspect(destination)
    } catch (error) {
      // Keep any downloaded files available for recovery; never recursively remove a checkout.
      throw new HttpError(
        400,
        `Could not clone GitHub repository. Check the repository URL and Git credentials on the runtime host. Inspect ${destination} before retrying; downloaded files may remain. ${errorMessage(error)}`,
      )
    }
  }
  private remoteEnvironment(url: string, authorization?: string) {
    const parsed = new URL(url)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new HttpError(400, 'Invalid Git clone URL')
    return {
      ...processEnvironment(),
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'never',
      GIT_TRACE: '0',
      GIT_TRACE_CURL: '0',
      GIT_CURL_VERBOSE: '0',
      GIT_TRACE_PACKET: '0',
      ...(authorization
        ? {
            GIT_CONFIG_COUNT: '3',
            GIT_CONFIG_KEY_0: `http.${url}.extraHeader`,
            GIT_CONFIG_VALUE_0: `Authorization: ${authorization}`,
            GIT_CONFIG_KEY_1: 'credential.helper',
            GIT_CONFIG_VALUE_1: '',
            GIT_CONFIG_KEY_2: 'http.followRedirects',
            GIT_CONFIG_VALUE_2: 'false',
          }
        : {}),
    }
  }
  async cloneRemote(
    repository: {
      name: string
      cloneUrl: string
    },
    directory: string,
    authorization?: string,
    github = false,
  ) {
    const parent = await repositoryPath(directory)
    // Repository names returned by a remote are not trusted filesystem paths.
    if (
      !repository.name ||
      repository.name.includes('/') ||
      repository.name.includes('\\') ||
      repository.name.includes('\0') ||
      ['.', '..'].includes(repository.name)
    )
      throw new HttpError(400, 'Invalid repository directory name')
    const destination = join(parent, repository.name)
    try {
      await mkdir(destination)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
        throw new HttpError(
          409,
          'This destination already exists. Add the existing local checkout or choose another folder.',
        )
      throw error
    }
    const gh = "'" + this.settings().gh.replaceAll("'", "'\"'\"'") + "'"
    try {
      await this.run(
        parent,
        this.settings().git,
        [
          ...(github
            ? ['-c', 'credential.helper=', '-c', `credential.helper=!${gh} auth git-credential`]
            : []),
          'clone',
          '--',
          repository.cloneUrl,
          destination,
        ],
        REPOSITORY_CLONE_TIMEOUT_MS,
        12 * 1024 * 1024,
        this.remoteEnvironment(repository.cloneUrl, authorization),
      )
      return await this.inspect(destination)
    } catch {
      throw new HttpError(
        400,
        `Could not clone this repository. Check its Git access and credentials. Downloaded files may remain in ${destination}; inspect that directory before retrying.`,
      )
    }
  }
  async changes(path: string): Promise<ChangedFile[]> {
    const { path: root } = await this.inspect(path)
    const tracked = (await this.command(root, ['ls-files', '-z'])).split('\0').filter(Boolean)
    const changed = (
      await this.command(root, [
        'status',
        '--porcelain=v1',
        '-z',
        '--untracked-files=all',
        '--no-renames',
      ])
    )
      .split('\0')
      .filter(Boolean)
      .map((line) => line.slice(3))
    let hasHead = true
    try {
      await this.command(root, ['rev-parse', '--verify', 'HEAD'])
    } catch (error) {
      if (
        !tracked.length ||
        (await this.command(root, ['rev-list', '--all', '--count'])).trim() === '0'
      )
        hasHead = false
      else throw error
    }
    const files: ChangedFile[] = []
    for (const name of [...new Set(changed)].slice(0, 200)) {
      const file = await safeFile(root, name)
      let after = ''
      try {
        const info = await stat(file)
        if (!info.isFile() || info.size > 2 * 1024 * 1024) continue
        after = await readFile(file, 'utf8')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      let before = ''
      if (hasHead) {
        const exists = await this.command(root, ['ls-tree', 'HEAD', '--', name])
        if (exists) before = await this.command(root, ['show', `HEAD:${name}`])
      }
      if (before.includes('\0') || after.includes('\0')) continue
      files.push({
        path: name,
        before,
        after,
        diskContents: after,
        viewed: false,
      })
    }
    return files
  }
  // An alternate index captures staged and unstaged contents without touching the user's index.
  async snapshot(cwd: string, ref: string) {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-checkpoint-'))
    const index = join(directory, 'index')
    try {
      const source = (
        await this.command(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index'])
      ).trim()
      try {
        await copyFile(source, index)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      const run = (args: string[]) =>
        this.run(cwd, this.settings().git, args, 120000, 12 * 1024 * 1024, {
          ...processEnvironment(),
          GIT_INDEX_FILE: index,
        })
      await run(['add', '-A', '--', '.'])
      const tree = (await run(['write-tree'])).trim()
      await this.command(cwd, ['update-ref', ref, tree])
      return tree
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
      })
    }
  }
  async checkpointChanges(cwd: string, before: string, after: string) {
    const names = (
      await this.command(cwd, ['diff', '--name-only', '--no-renames', '-z', before, after, '--'])
    )
      .split('\0')
      .filter(Boolean)
    const files: ChangedFile[] = [],
      omitted: string[] = []
    let remaining = 8 * 1024 * 1024
    for (const name of names) {
      if (files.length >= 200) {
        omitted.push(name)
        continue
      }
      const contents: string[] = []
      let supported = true
      for (const tree of [before, after]) {
        const entry = await this.command(cwd, [
          '--literal-pathspecs',
          'ls-tree',
          '-z',
          tree,
          '--',
          name,
        ])
        if (!entry) {
          contents.push('')
          continue
        }
        const [mode, type, hash] = entry.split('\t')[0].split(' ')
        if (type !== 'blob' || !['100644', '100755'].includes(mode)) {
          supported = false
          break
        }
        const size = Number((await this.command(cwd, ['cat-file', '-s', hash])).trim())
        if (size > 2 * 1024 * 1024 || size > remaining) {
          supported = false
          break
        }
        const content = await this.command(cwd, ['cat-file', 'blob', hash])
        if (content.includes('\0') || content.includes('\ufffd')) {
          supported = false
          break
        }
        remaining -= size
        contents.push(content)
      }
      if (!supported) omitted.push(name)
      else
        files.push({
          path: name,
          before: contents[0],
          after: contents[1],
          viewed: false,
        })
    }
    return {
      files,
      omitted,
    }
  }
  async save(path: string, name: string, expected: string, contents: string) {
    const { path: root } = await this.inspect(path)
    const full = await safeFile(root, name)
    let current = ''
    try {
      current = await readFile(full, 'utf8')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    if (current !== expected)
      throw new HttpError(409, 'File changed on disk. Refresh before applying your draft.')
    await writeFile(full, contents)
  }
  async stage(path: string, names: string[]) {
    const { path: root } = await this.inspect(path)
    for (const name of names) await safeFile(root, name)
    if (names.length) await this.command(root, ['add', '--', ...names])
  }
  async commit(path: string, message: string) {
    const { path: root } = await this.inspect(path)
    await this.command(root, ['commit', '-m', message])
    return (await this.command(root, ['rev-parse', 'HEAD'])).trim()
  }
  async fetchPull(
    cwd: string,
    repositoryUrl: string,
    number: number,
    ref: string,
    source?: NonNullable<Task['pullRequest']>,
  ) {
    if (source?.provider && source.provider !== 'github') {
      if (!source.cloneUrl || !source.headRef)
        throw new HttpError(
          400,
          'Refresh this PR and create a new task to capture its checkout reference',
        )
      if (!/^(refs\/[^\s:]+|[a-f0-9]{40})$/.test(source.headRef))
        throw new HttpError(400, 'Invalid pull request Git reference')
      const authorization = source.connectionId
        ? await this.forgeAuthorization?.(source.connectionId, source.cloneUrl, cwd)
        : undefined
      await this.run(
        cwd,
        this.settings().git,
        [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--',
          source.cloneUrl,
          `${source.headRef}:${ref}`,
        ],
        60000,
        12 * 1024 * 1024,
        this.remoteEnvironment(source.cloneUrl, authorization),
      )
      return
    }
    const remote = `${repositoryUrl.replace(/\/$/, '')}.git`
    const authorization = source?.connectionId
      ? await this.forgeAuthorization?.(source.connectionId, remote, cwd)
      : undefined
    if (authorization) {
      await this.run(
        cwd,
        this.settings().git,
        [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--',
          remote,
          `refs/pull/${number}/head:${ref}`,
        ],
        60000,
        12 * 1024 * 1024,
        this.remoteEnvironment(remote, authorization),
      )
      return
    }
    const gh = "'" + this.settings().gh.replaceAll("'", "'\"'\"'") + "'"
    await this.command(cwd, [
      '-c',
      'credential.helper=',
      '-c',
      `credential.helper=!${gh} auth git-credential`,
      'fetch',
      '--no-tags',
      '--no-write-fetch-head',
      '--',
      remote,
      `refs/pull/${number}/head:${ref}`,
    ])
  }
  async github(path: string, args: string[]) {
    const { path: cwd } = await this.inspect(path)
    return this.run(cwd, this.settings().gh, args, 60000, 32 * 1024 * 1024)
  }
  githubAccount(
    args: string[],
    limits?: {
      timeout: number
      maxBuffer: number
    },
    cwd?: string,
    account?: {
      host: string
      token: string
    },
  ) {
    // Account discovery must work before any local checkout has been registered.
    return this.run(
      cwd ?? homedir(),
      this.settings().gh,
      args,
      limits?.timeout ?? 20000,
      limits?.maxBuffer ?? 4 * 1024 * 1024,
      {
        ...processEnvironment(),
        GH_PROMPT_DISABLED: '1',
        ...(account
          ? {
              GH_HOST: account.host,
              GH_TOKEN: account.token,
              GH_ENTERPRISE_TOKEN: account.token,
              GITHUB_TOKEN: undefined,
              GITHUB_ENTERPRISE_TOKEN: undefined,
            }
          : {}),
      },
    )
  }
  async pullRequests(path: string) {
    const result = await this.github(path, [
      'pr',
      'list',
      '--json',
      'number,title,url,state,headRefName',
    ])
    return decode(
      mutableArray(
        mutableStruct({
          number: Schema.Number.pipe(Schema.finite()),
          title: Schema.String,
          url: Schema.String.pipe(Schema.compose(urlSchema())),
          state: Schema.String,
          headRefName: Schema.String,
        }),
      ),
      JSON.parse(result),
    )
  }
}
