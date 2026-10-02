import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createFilePreview } from './file-preview.js'
import type { FilePreviewMetadata } from '@dovo/protocol'
import { GithubBudget } from './github-budget.js'
import { gitRemoteIdentity } from '@dovo/protocol'
import { defaultShell, shellArguments } from '../../terminal/shell.js'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, urlSchema } from '@dovo/protocol'
import { readFile, writeFile, stat, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Schema } from 'effect'
import { commandsSchema, REPOSITORY_CLONE_TIMEOUT_MS, type CommandSettings } from '@dovo/protocol'
import type { ChangedFile } from '@dovo/protocol'
import type { Task } from '@dovo/protocol'
import { exec, processEnvironment } from '../../process.js'
import { HttpError, errorMessage } from '../../errors.js'
import { repositoryPath, safeFile } from '../repositories/paths.js'
export class GitService {
  private githubBudget = new GithubBudget()
  private githubRequest(
    cwd: string,
    args: string[],
    timeout: number,
    maxBuffer: number,
    env: NodeJS.ProcessEnv,
  ) {
    const hostIndex = args.indexOf('--hostname')
    const repoIndex = args.indexOf('--repo')
    const repositoryHost =
      repoIndex >= 0 && args[repoIndex + 1]?.split('/').length === 3
        ? args[repoIndex + 1]?.split('/')[0]
        : undefined
    const host =
      (hostIndex >= 0 ? args[hostIndex + 1] : repositoryHost) ?? env.GH_HOST ?? 'github.com'
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          host,
          env.GH_CONFIG_DIR,
          env.GH_TOKEN,
          env.GITHUB_TOKEN,
          env.GH_ENTERPRISE_TOKEN,
          env.GITHUB_ENTERPRISE_TOKEN,
        ]),
      )
      .digest('hex')
    return this.githubBudget.run(
      key,
      () => this.run(cwd, this.settings().gh, args, timeout, maxBuffer, env),
      () =>
        this.run(
          cwd,
          this.settings().gh,
          ['api', '--hostname', host, 'rate_limit'],
          20000,
          1024 * 1024,
          env,
        ),
    )
  }
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
  setupWorktree(cwd: string, script: string) {
    const settings = this.settings()
    return this.run(
      cwd,
      settings.shell || defaultShell(),
      process.platform === 'win32' && !settings.shell
        ? [
            ...shellArguments(settings),
            '-Command',
            `$ErrorActionPreference = 'Stop';\n${script}\nif ($LASTEXITCODE) { exit $LASTEXITCODE }`,
          ]
        : [...shellArguments(settings), '-c', `set -e\n${script}`],
      300000,
      2 * 1024 * 1024,
    )
  }
  command(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
    return this.run(cwd, this.settings().git, args, 30000, 12 * 1024 * 1024, env)
  }
  // Credential helpers answer or fail; git must never wait on a terminal prompt.
  private nonInteractive() {
    return { ...processEnvironment(), GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }
  }
  private publishing = new Set<string>()
  async folderStatus(path: string) {
    const cwd = await repositoryPath(path)
    try {
      await stat(join(cwd, '.git'))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { initialized: false, remotes: [] }
      throw error
    }
    return {
      initialized: true,
      remotes: (await this.command(cwd, ['remote'])).trim().split('\n').filter(Boolean),
    }
  }
  async createGithub(path: string, name: string, visibility: 'private' | 'public') {
    const cwd = await repositoryPath(path)
    if (this.publishing.has(cwd))
      throw new HttpError(409, 'Repository creation is already in progress')
    this.publishing.add(cwd)
    try {
      const status = await this.folderStatus(cwd)
      if (status.remotes.length)
        throw new HttpError(
          409,
          'This folder already has a Git remote. Existing remotes will not be replaced.',
        )
      // Validate GitHub authentication before initializing a local repository.
      await this.run(cwd, this.settings().gh, ['auth', 'status'], 30000, 1024 * 1024)
      if (!status.initialized) await this.command(cwd, ['init', '-b', 'main'])
      await this.run(
        cwd,
        this.settings().gh,
        ['repo', 'create', name, `--${visibility}`, '--source', cwd, '--remote', 'origin'],
        60000,
        1024 * 1024,
      )
      return this.inspect(cwd)
    } finally {
      this.publishing.delete(cwd)
    }
  }
  async push(path: string) {
    const { path: cwd } = await this.inspect(path)
    const branch = (await this.command(cwd, ['branch', '--show-current'])).trim()
    if (!branch) throw new HttpError(409, 'Check out a branch before pushing')
    const remote = (
      await this.command(cwd, [
        'for-each-ref',
        '--format=%(upstream:remotename)',
        `refs/heads/${branch}`,
      ])
    ).trim()
    if (remote === '.')
      throw new HttpError(
        409,
        'This branch tracks a local branch. Configure a remote upstream first.',
      )
    const remotes = (await this.folderStatus(cwd)).remotes
    const destination =
      remote ||
      (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined)
    if (!destination)
      throw new HttpError(409, 'Choose a Git remote or create a GitHub repository before pushing')
    const ref = remote
      ? (
          await this.command(cwd, [
            'for-each-ref',
            '--format=%(upstream:remoteref)',
            `refs/heads/${branch}`,
          ])
        ).trim()
      : `refs/heads/${branch}`
    const gh = "'" + this.settings().gh.replaceAll("'", "'\"'\"'") + "'"
    await this.command(
      cwd,
      [
        '-c',
        'credential.https://github.com.helper=',
        '-c',
        `credential.https://github.com.helper=!${gh} auth git-credential`,
        'push',
        '--set-upstream',
        '--',
        destination,
        `HEAD:${ref}`,
      ],
      this.nonInteractive(),
    )
  }
  async openFolder(path: string, target: 'finder' | 'vscode' | 'cursor') {
    const cwd = await repositoryPath(path)
    if (process.platform !== 'darwin')
      throw new HttpError(400, 'Opening Finder or a Mac editor requires a macOS runtime')
    await this.run(
      cwd,
      '/usr/bin/open',
      target === 'finder'
        ? [cwd]
        : ['-a', target === 'vscode' ? 'Visual Studio Code' : 'Cursor', cwd],
      10000,
      1024 * 1024,
    )
  }
  private identities = new Map<string, { expires: number; result: Promise<string | undefined> }>()
  repositoryIdentity(path: string, refresh = false) {
    const cached = this.identities.get(path)
    if (!refresh && cached && cached.expires > Date.now()) return cached.result
    const result = this.readRepositoryIdentity(path)
    this.identities.set(path, { expires: Date.now() + 60000, result })
    return result
  }
  // Non-blocking read for hot paths (e.g. the snapshot route): never spawns git inline.
  // Returns the last known identity, refreshing it in the background so the next poll sees it.
  cachedRepositoryIdentity(path: string) {
    const cached = this.identities.get(path)
    if (!cached || cached.expires <= Date.now()) this.repositoryIdentity(path).catch(() => {})
    return cached?.result
  }
  private async readRepositoryIdentity(path: string) {
    const remotes = (await this.command(path, ['remote'])).trim().split('\n').filter(Boolean)
    // Prefer the clone's origin: merging every remote would incorrectly merge forks.
    if (remotes.includes('origin'))
      return gitRemoteIdentity(await this.command(path, ['remote', 'get-url', 'origin']))
    const identities = await Promise.all(
      remotes.map(async (name) =>
        gitRemoteIdentity(await this.command(path, ['remote', 'get-url', name])),
      ),
    )
    const unique = new Set(identities)
    if (unique.size === 1) return identities[0]
    // Ambiguous remotes remain separate rather than changing identity with the branch.
    return undefined
  }
  async isRepository(cwd: string) {
    try {
      return (
        (
          await this.command(cwd, ['rev-parse', '--is-inside-work-tree'], {
            ...processEnvironment(),
            LC_ALL: 'C',
          })
        ).trim() === 'true'
      )
    } catch (error) {
      if (/not a git repository/i.test(errorMessage(error))) return false
      throw error
    }
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
        // One oversized or unreadable committed blob must not fail the whole listing.
        try {
          const exists = await this.command(root, [
            '--literal-pathspecs',
            'ls-tree',
            'HEAD',
            '--',
            name,
          ])
          if (exists) {
            const size = Number(
              (await this.command(root, ['cat-file', '-s', `HEAD:${name}`])).trim(),
            )
            if (!Number.isFinite(size) || size > 2 * 1024 * 1024) continue
            before = await this.command(root, ['show', `HEAD:${name}`])
          }
        } catch {
          continue
        }
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
  /** Makes the working tree match a snapshot tree, without touching HEAD, the branch or the
   * index. The current state is saved to `backupRef` first and returned, so it can be restored.
   * Only paths that differ are written or removed. */
  async restoreSnapshot(cwd: string, target: string, backupRef: string, only?: string[]) {
    const current = await this.snapshot(cwd, backupRef)
    if (current === target) return current
    const names = (
      await this.command(cwd, [
        '--literal-pathspecs',
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        current,
        target,
        '--',
        ...(only ?? []),
      ])
    )
      .split('\0')
      .filter(Boolean)
    const directory = await mkdtemp(join(tmpdir(), 'dovo-restore-'))
    const index = join(directory, 'index')
    try {
      const run = (args: string[]) =>
        this.run(cwd, this.settings().git, args, 120000, 12 * 1024 * 1024, {
          ...processEnvironment(),
          GIT_INDEX_FILE: index,
        })
      await run(['read-tree', target])
      const chunks = <T>(items: T[]) =>
        Array.from({ length: Math.ceil(items.length / 200) }, (_, at) =>
          items.slice(at * 200, at * 200 + 200),
        )
      const present = new Set<string>()
      for (const chunk of chunks(names))
        for (const name of (
          await run(['--literal-pathspecs', 'ls-files', '-z', '--', ...chunk])
        ).split('\0'))
          if (name) present.add(name)
      // Remove first, so a file replaced by a folder (or the reverse) can be written after.
      for (const name of names)
        if (!present.has(name)) await rm(await safeFile(cwd, name), { force: true })
      const write = names.filter((name) => present.has(name))
      for (const chunk of chunks(write))
        await run(['--literal-pathspecs', 'checkout-index', '-f', '--', ...chunk])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
    return current
  }
  /** The tree of HEAD, or the empty tree in a repository without commits. */
  async headTree(cwd: string) {
    try {
      return (await this.command(cwd, ['rev-parse', 'HEAD^{tree}'])).trim()
    } catch {
      return '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
    }
  }
  async checkpointChanges(
    cwd: string,
    before: string,
    after: string,
  ): Promise<{ files: ChangedFile[]; omitted: string[] }> {
    const names = (
      await this.command(cwd, ['diff', '--name-only', '--no-renames', '-z', before, after, '--'])
    )
      .split('\0')
      .filter(Boolean)
    const files: ChangedFile[] = []
    const trees = await Promise.all([before, after].map((tree) => this.treeFiles(cwd, tree, names)))
    // These limits bound embedded previews, never the list of saved files.
    let remaining = 1024 * 1024
    let previews = 0
    // A blob is immutable. Identical files and unchanged sides need only one Git read.
    const blobs = new Map<string, string>()
    let cachedBytes = 0
    const contentOf = async (hash: string) => {
      const saved = blobs.get(hash)
      if (saved !== undefined) return saved
      const content = await this.command(cwd, ['cat-file', 'blob', hash])
      if (content.includes('\0') || content.includes('\ufffd')) {
        // Keep only the classification marker, never hundreds of binary bodies.
        blobs.set(hash, '\0')
      } else {
        const bytes = Buffer.byteLength(content)
        if (cachedBytes + bytes <= 1024 * 1024) {
          cachedBytes += bytes
          blobs.set(hash, content)
        }
      }
      return content
    }
    for (const name of names) {
      const sides = { before: trees[0].get(name), after: trees[1].get(name) }
      const entries = [sides.before, sides.after].filter((side) => side !== undefined)
      let kind: FilePreviewMetadata['kind'] | undefined = entries.some(
        (side) => side.mode === '160000',
      )
        ? 'submodule'
        : entries.some((side) => side.mode === '120000')
          ? 'symlink'
          : entries.some((side) => side.size > 256 * 1024)
            ? 'large'
            : previews >= 200 || entries.reduce((sum, side) => sum + side.size, 0) > remaining
              ? 'deferred'
              : undefined
      const contents: string[] = []
      if (!kind) {
        for (const side of [sides.before, sides.after]) {
          const content = side ? await contentOf(side.hash) : ''
          if (content.includes('\0') || content.includes('\ufffd')) {
            kind = /\.(png|jpe?g|webp|gif|avif|tiff?|heic|ico)$/i.test(name) ? 'image' : 'binary'
            break
          }
          contents.push(content)
        }
      }
      if (kind) {
        if (kind === 'large' && /\.(png|jpe?g|webp|gif|avif|tiff?|heic|ico)$/i.test(name))
          kind = 'image'
        files.push({
          path: name,
          before: '',
          after: '',
          viewed: false,
          preview: { kind, ...sides },
        })
      } else {
        remaining -= entries.reduce((sum, side) => sum + side.size, 0)
        previews++
        files.push({ path: name, before: contents[0], after: contents[1], viewed: false })
      }
    }
    return { files, omitted: [] }
  }
  private async treeFiles(cwd: string, tree: string, names: string[]) {
    const files = new Map<string, NonNullable<FilePreviewMetadata['before']>>()
    for (let index = 0; index < names.length; index += 200) {
      const output = await this.command(cwd, [
        '--literal-pathspecs',
        'ls-tree',
        '-z',
        '-l',
        tree,
        '--',
        ...names.slice(index, index + 200),
      ])
      for (const entry of output.split('\0').filter(Boolean)) {
        const tab = entry.indexOf('\t')
        const [mode, , hash, size] = entry.slice(0, tab).trim().split(/\s+/)
        files.set(entry.slice(tab + 1), { mode, hash, size: size === '-' ? 0 : Number(size) })
      }
    }
    return files
  }
  async checkpointFilePreview(cwd: string, before: string, after: string, path: string) {
    const sides = await Promise.all(
      [before, after].map((tree) => this.treeFiles(cwd, tree, [path])),
    )
    const old = sides[0].get(path),
      next = sides[1].get(path)
    if (!old && !next) throw new HttpError(404, 'This file is not in the saved snapshots.')
    return createFilePreview(path, { before: old, after: next }, (hash, limit) =>
      this.blobPrefix(cwd, hash, limit),
    )
  }
  /** Read a bounded prefix without buffering the rest of a potentially huge saved blob. */
  private blobPrefix(cwd: string, hash: string, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.settings().git, ['cat-file', 'blob', hash], {
        cwd,
        env: processEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const chunks: Buffer[] = []
      let size = 0,
        stopped = false,
        stderr = ''
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new HttpError(504, 'File preview timed out.'))
      }, 30000)
      child.stdout.on('data', (chunk: Buffer) => {
        const prefix = chunk.subarray(0, limit - size)
        chunks.push(prefix)
        size += prefix.length
        if (size >= limit) {
          stopped = true
          child.kill('SIGKILL')
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(0, 4000)
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code !== 0 && !stopped)
          reject(new HttpError(500, stderr || 'Could not load the saved file.'))
        else resolve(Buffer.concat(chunks, size))
      })
    })
  }

  /** Committed changes on this branch since its merge base with the default branch. */
  async branchChangesFiles(cwd: string) {
    const { before, after, base } = await this.branchTrees(cwd)
    return { ...(await this.checkpointChanges(cwd, before, after)), base }
  }
  async branchTrees(cwd: string) {
    const head = (await this.command(cwd, ['rev-parse', '--verify', 'HEAD'])).trim()
    const originHead = await this.command(cwd, [
      'symbolic-ref',
      '-q',
      'refs/remotes/origin/HEAD',
    ]).catch(() => '')
    const candidates = [
      originHead.trim(),
      'refs/remotes/origin/main',
      'refs/remotes/origin/master',
      'refs/heads/main',
      'refs/heads/master',
    ].filter(Boolean)
    let base: string | undefined
    for (const candidate of candidates) {
      if (
        (
          await this.command(cwd, ['rev-parse', '--verify', '--quiet', candidate]).catch(() => '')
        ).trim()
      ) {
        base = candidate
        break
      }
    }
    if (!base)
      throw new HttpError(
        409,
        'No default branch was found. Set origin/HEAD or create a main or master branch.',
      )
    const ancestor = (await this.command(cwd, ['merge-base', base, head])).trim()
    return { before: ancestor, after: head, base }
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
    // Literal names: a path such as a[1].txt must not stage every glob match.
    if (names.length) await this.command(root, ['--literal-pathspecs', 'add', '--', ...names])
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
    await this.command(
      cwd,
      [
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
      ],
      this.nonInteractive(),
    )
  }
  async github(path: string, args: string[]) {
    const { path: cwd } = await this.inspect(path)
    return this.githubRequest(cwd, args, 60000, 32 * 1024 * 1024, processEnvironment())
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
    return this.githubRequest(
      cwd ?? homedir(),
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
