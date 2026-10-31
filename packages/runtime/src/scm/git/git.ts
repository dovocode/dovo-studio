import { githubRead } from '../../retrieval/request.js'
import { retrievalContext, retrievalLocal, type RetrievalHook } from '../../retrieval/context.js'
import { includedWorktreeFiles, copyWorktreeFiles } from './worktree-include.js'
import { worktreeRecords } from './worktree-records.js'
import {
  stopOwnedChild,
  OwnedProcessShutdownError,
} from '../../agents/execution/stop-owned-child.js'
import { createHash, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { spawn, execFile } from 'node:child_process'
import { createFilePreview } from './file-preview.js'
import { GitBlobReader } from './cat-file-batch.js'
import { detectInstalledOpeners, type InstalledOpener } from './installed-openers.js'
import { folderOpenCommand, launchDesktop } from './open-folder.js'
import type { RepositoryOpenTarget } from '@dovo/protocol'
import type { FilePreviewMetadata } from '@dovo/protocol'
import { GithubBudget } from './github-budget.js'
import type { GithubResponseInfo } from './github-rate-limit.js'
import {
  githubAccessError,
  githubRequestRepository,
  type GithubAccessContext,
} from './github-access.js'
import {
  GithubApiError,
  GithubCredentials,
  GithubTransport,
  parseGithubApiArgs,
} from './github-transport.js'
import { gitRemoteIdentity } from '@dovo/protocol'
import { defaultShell, shellArguments } from '../../terminal/shell.js'
import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, urlSchema } from '@dovo/protocol'
import {
  readFile,
  writeFile,
  stat,
  lstat,
  readlink,
  open,
  mkdir,
  rmdir,
  mkdtemp,
  rm,
  copyFile,
  realpath,
} from 'node:fs/promises'
import { join, dirname, basename, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Schema } from 'effect'
import { commandsSchema, REPOSITORY_CLONE_TIMEOUT_MS, type CommandSettings } from '@dovo/protocol'
import type { ChangedFile } from '@dovo/protocol'
import type { Task } from '@dovo/protocol'
import { exec, ProcessError, processEnvironment } from '../../process.js'
import { HttpError, errorMessage } from '../../errors.js'
import { repositoryPath, safeFile } from '../repositories/paths.js'
import { withFileWrite } from '../repositories/file-writes.js'
/** Recorded fork point of a task branch; see `Task['worktreeBase']`. */
export type BranchBase = { branch?: string; ref?: string; commit?: string }
export type GithubAccount = {
  host: string
  token: string
  env?: Record<string, string>
  onUnauthorized?: () => void
  beforeDispatch?: () => void
  access?: GithubAccessContext
}
// Shared between service instances; linked worktrees write the same config file. Entries
// exist only while Studio owns or is waiting for a write. External Git keeps its own locks.
const sharedConfigWrites = new Map<string, Promise<void>>()
const unconfirmedCheckoutCommands = new Map<string, Set<OwnedProcessShutdownError>>()
const preparationOwnership = new AsyncLocalStorage<ReadonlyMap<string, string>>()
function changesRepositoryIdentity(args: readonly string[]) {
  // Branch switches can change includeIf.onbranch, even without editing config.
  if (args[0] === 'checkout' || args[0] === 'switch') return true
  if (args[0] === 'remote')
    return ['add', 'rename', 'remove', 'rm', 'set-head', 'set-branches', 'set-url'].includes(
      args[1] ?? '',
    )
  return (
    args[0] === 'config' &&
    args[1] !== 'get' &&
    args[1] !== 'list' &&
    !args.some((arg) =>
      ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l'].includes(arg),
    )
  )
}
export class GitService {
  retrieval?: RetrievalHook
  private sharedReaders = new Map<string, { until: number; value: Promise<string> }>()
  async retrievalReader(account: GithubAccount) {
    const key = createHash('sha256')
      .update(account.host + account.token)
      .digest('hex')
    let reader = this.sharedReaders.get(key)
    if (!reader || reader.until < Date.now()) {
      const value = retrievalLocal(async () => {
        const user = decode(
          mutableStruct({
            id: Schema.Number.pipe(
              Schema.check(Schema.isInt()),
              Schema.check(Schema.isGreaterThan(0)),
            ),
          }),
          JSON.parse(
            await this.githubAccount(
              ['api', '--hostname', account.host, 'user'],
              undefined,
              undefined,
              account,
            ),
          ),
        )
        return createHash('sha256')
          .update(JSON.stringify(['github', account.host.toLowerCase(), String(user.id)]))
          .digest('hex')
      })
      reader = { until: Date.now() + 600000, value }
      this.sharedReaders.set(key, reader)
      if (this.sharedReaders.size > 100)
        this.sharedReaders.delete(this.sharedReaders.keys().next().value!)
      void value.catch(() => {
        if (this.sharedReaders.get(key)?.value === value) this.sharedReaders.delete(key)
      })
    }
    return reader.value
  }
  private githubBudget = new GithubBudget()
  private githubCredentials = new GithubCredentials(() => this.settings().gh)
  private githubTransport = new GithubTransport()
  /** `gh api` requests go to GitHub's API with a token gh mints per host and checkout; the
   * other gh commands (repo view, pr view, auth status, repo create) still run the CLI. */
  private async githubApiRequest(
    cwd: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    background: boolean,
    input?: string,
    maxBytes?: number,
    onUnauthorized?: () => void,
    beforeDispatch?: () => void,
    access?: GithubAccessContext,
  ) {
    const request = parseGithubApiArgs(args, input)
    const audited = [this.settings().gh, ...args]
    this.audit?.(cwd, audited)
    const responses: GithubResponseInfo[] = []
    const diagnostics = {
      host: request.host,
      method: request.method,
      endpoint: request.path,
      background,
      responses,
    }
    const accessContext = {
      ...access,
      host: request.host,
      repository: access?.repository ?? githubRequestRepository(request),
      source: access
        ? access.source
        : GithubCredentials.environmentToken(request.host, env)
          ? 'environment'
          : 'gh',
    } satisfies GithubAccessContext
    try {
      const credential = await this.githubCredentials.capture(request.host, cwd, env)
      const token = credential.token
      const key = createHash('sha256')
        .update(JSON.stringify([request.host, token]))
        .digest('hex')
      const load = () =>
        this.githubBudget.run(
          key,
          async () => {
            beforeDispatch?.()
            const text = await this.githubTransport.send(request, token, {
              maxBytes,
              onResponse: (info) => {
                responses.push(info)
                if (info.quota) this.githubBudget.observe(key, info.quota, info.resource)
              },
              onUnauthorized: () => {
                credential.onUnauthorized()
                onUnauthorized?.()
              },
            })
            return text
          },
          () =>
            this.githubTransport.send(
              parseGithubApiArgs(['api', '--hostname', request.host, 'rate_limit']),
              token,
            ),
          { background, resource: request.graphql ? 'graphql' : 'core' },
        )
      let result: string
      if (
        this.retrieval?.active() &&
        !retrievalContext()?.local &&
        request.path !== 'user' &&
        request.path !== 'rate_limit'
      ) {
        const reader = await this.retrievalReader({ host: request.host, token })
        beforeDispatch?.()
        if (githubRead(args, input)) {
          result = await this.retrieval.read(
            { provider: 'github', instance: request.host, reader, args, input, watch: background },
            load,
          )
        } else {
          await this.retrieval.invalidate('github', request.host, reader)
          try {
            result = await load()
          } finally {
            await this.retrieval.invalidate('github', request.host, reader)
          }
        }
        beforeDispatch?.()
      } else result = await load()
      if (maxBytes !== undefined && Buffer.byteLength(result) > maxBytes)
        throw new GithubApiError(502, 'GitHub response exceeded its byte limit')
      this.audit?.(cwd, audited, { github: diagnostics })
      return result
    } catch (error) {
      const failure = githubAccessError(error, accessContext)
      this.audit?.(cwd, audited, { error: errorMessage(failure), github: diagnostics })
      throw failure
    }
  }
  private async githubRequest(
    cwd: string,
    args: string[],
    timeout: number,
    maxBuffer: number,
    env: NodeJS.ProcessEnv,
    background = false,
    input?: string,
    onUnauthorized?: () => void,
    beforeDispatch?: () => void,
    discoveredHost?: string,
    access?: GithubAccessContext,
  ) {
    if (args[0] === 'api')
      return this.githubApiRequest(
        cwd,
        args,
        env,
        background,
        input,
        maxBuffer,
        onUnauthorized,
        beforeDispatch,
        access,
      )
    if (input !== undefined) throw new HttpError(400, 'Only gh api requests accept a body')
    const hostIndex = args.indexOf('--hostname')
    const repoIndex = args.indexOf('--repo')
    const repositoryHost =
      repoIndex >= 0 && args[repoIndex + 1]?.split('/').length === 3
        ? args[repoIndex + 1]?.split('/')[0]
        : undefined
    const host =
      (hostIndex >= 0 ? args[hostIndex + 1] : repositoryHost) ??
      discoveredHost ??
      env.GH_HOST ??
      'github.com'
    // Local authentication commands must remain usable even while an API bucket is exhausted.
    if (args[0] === 'auth') {
      beforeDispatch?.()
      return this.run(cwd, this.settings().gh, args, timeout, maxBuffer, env)
    }
    const token = await this.githubCredentials.token(host, cwd, env)
    const key = createHash('sha256')
      .update(JSON.stringify([host, token]))
      .digest('hex')
    return this.githubBudget.run(
      key,
      async () => {
        beforeDispatch?.()
        const result = await this.run(cwd, this.settings().gh, args, timeout, maxBuffer, {
          ...env,
          GH_TOKEN: token,
          GH_ENTERPRISE_TOKEN: token,
        })
        if (args.includes('graphql')) this.githubBudget.observeGraphql(key, result)
        return result
      },
      () =>
        this.githubTransport.send(
          parseGithubApiArgs(['api', '--hostname', host, 'rate_limit']),
          token,
        ),
      { background, resource: 'graphql' },
    )
  }
  constructor(
    private settings: () => CommandSettings = () => decode(commandsSchema, {}),
    private audit?: (
      cwd: string,
      args: string[],
      result?: {
        error?: string
        github?: {
          host: string
          method: string
          endpoint: string
          background: boolean
          responses: GithubResponseInfo[]
        }
      },
    ) => void,
    private forgeAuthorization?: (
      connectionId: string,
      remote: string,
      cwd: string,
    ) => string | Promise<string>,
    private repositoryGithubEnvironment?: (cwd: string) => Promise<Record<string, string>>,
    private worktreeCreated?: (common: string, directory: string) => void,
    private repositoryProvider?: (identity: string) => 'github' | undefined,
  ) {}
  async githubEnvironment(cwd: string) {
    return this.repositoryGithubEnvironment?.(cwd) ?? {}
  }
  private async run(
    cwd: string,
    executable: string,
    args: string[],
    timeout: number,
    maxBuffer: number,
    env = processEnvironment(),
    signal?: AbortSignal,
  ) {
    this.audit?.(cwd, [executable, ...args])
    try {
      const result = await exec(executable, args, {
        cwd,
        env,
        timeout,
        maxBuffer,
        signal,
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
  async setupWorktree(cwd: string, script: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
    const settings = this.settings()
    const command = settings.shell || defaultShell()
    const args =
      process.platform === 'win32' && !settings.shell
        ? [
            ...shellArguments(settings),
            '-Command',
            `$ErrorActionPreference = 'Stop';\n${script}\nif ($LASTEXITCODE) { exit $LASTEXITCODE }`,
          ]
        : [...shellArguments(settings), '-c', `set -e\n${script}`]
    return this.runOwnedCommand(cwd, command, args, 'Worktree setup', 2 * 1024 * 1024, signal)
  }
  /** A crashed runtime cannot prove that its detached setup commands have stopped. */
  async withWorktreePreparation<T>(
    directory: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted()
    const canonical = await realpath(directory)
    await this.assertCheckoutAvailable(canonical)
    const reason = `dovo-preparing ${randomUUID()}`
    const records = worktreeRecords(
      await this.command(canonical, ['worktree', 'list', '--porcelain', '-z']),
    )
    const record = records.find((item) => item.path && resolve(item.path) === resolve(canonical))
    if (!record || record.main)
      throw new HttpError(409, 'Worktree preparation requires a registered linked worktree.')
    await this.command(canonical, ['worktree', 'lock', '--reason', reason, canonical])
    const unlock = async () => {
      const output = await this.command(canonical, ['worktree', 'list', '--porcelain', '-z'])
      const own = output.split('\0\0').some((block) => {
        const lines = block.split('\0')
        const path = lines.find((line) => line.startsWith('worktree '))?.slice(9)
        return path && resolve(path) === resolve(canonical) && lines.includes(`locked ${reason}`)
      })
      if (!own)
        throw new HttpError(
          409,
          `Worktree preparation ownership changed at ${canonical}; its lock was preserved.`,
        )
      await this.command(canonical, ['worktree', 'unlock', canonical])
    }
    let outcome: { ok: true; value: T } | { ok: false; error: unknown }
    try {
      signal?.throwIfAborted()
      const ownership = new Map(preparationOwnership.getStore())
      ownership.set(canonical, reason)
      outcome = { ok: true, value: await preparationOwnership.run(ownership, operation) }
    } catch (error) {
      if (error instanceof OwnedProcessShutdownError) {
        // Keep the durable lock as well as the live quarantine until exit is positively confirmed.
        void error.confirmed?.then(unlock).catch((cause: unknown) => {
          this.audit?.(canonical, ['worktree', 'unlock', canonical], { error: errorMessage(cause) })
        })
        throw error
      }
      outcome = { ok: false, error }
    }
    try {
      await unlock()
    } catch (error) {
      if (!outcome.ok)
        throw new AggregateError(
          [outcome.error, error],
          `Worktree preparation failed at ${canonical}; inspect its Git lock before retrying.`,
        )
      throw error
    }
    if (!outcome.ok) throw outcome.error
    return outcome.value
  }
  /** Preparation commands may run hooks or checkout descendants; Stop owns the entire tree. */
  async checkoutCommand(
    cwd: string,
    args: string[],
    signal?: AbortSignal,
    env: NodeJS.ProcessEnv = this.nonInteractive(),
    timeoutMs = 300000,
  ) {
    const changesIdentity = changesRepositoryIdentity(args)
    if (changesIdentity) this.identities.clear()
    try {
      return await this.runOwnedCommand(
        cwd,
        this.settings().git,
        args,
        'Git checkout',
        12 * 1024 * 1024,
        signal,
        env,
        timeoutMs,
      )
    } finally {
      if (changesIdentity) this.identities.clear()
    }
  }
  private async runOwnedCommand(
    cwd: string,
    command: string,
    args: string[],
    label: string,
    maxBuffer: number,
    signal?: AbortSignal,
    env = processEnvironment(),
    timeoutMs = 300000,
  ) {
    signal?.throwIfAborted()
    const ownedPath = await realpath(cwd)
    await this.assertCheckoutAvailable(ownedPath)
    this.audit?.(cwd, [command, ...args])
    const child = spawn(command, args, {
      windowsHide: true,
      cwd,
      env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let failure: Error | undefined
    let cleanup: Promise<void> | undefined
    let bytes = 0
    let stdout = ''
    let stderr = ''
    let pipeDeadline: ReturnType<typeof setTimeout> | undefined
    let confirmPipes!: () => void
    const pipesClosed = new Promise<void>((resolve) => {
      confirmPipes = resolve
    })
    child.once('close', confirmPipes)
    let rejectShutdown!: (error: unknown) => void
    const shutdownFailed = new Promise<never>((_resolve, reject) => {
      rejectShutdown = reject
    })
    const stop = (error: Error) => {
      failure ??= error
      if (!cleanup) {
        cleanup = stopOwnedChild(child)
        // A failed kill must report the shutdown error even if close never arrives.
        void cleanup.catch(rejectShutdown)
      }
    }
    const aborted = () => stop(new Error(`${label} cancelled`, { cause: signal?.reason }))
    child.once('exit', () => {
      // Start draining descendants on launcher exit, even when they inherited its pipes.
      // An escaped group retaining those pipes cannot prove shutdown: report a bounded
      // failure and retain ownership until genuine EOF, rather than destroying the evidence.
      cleanup ??= stopOwnedChild(child)
      void cleanup.then(() => {
        if (child.stdout.readableEnded && child.stderr.readableEnded) return
        pipeDeadline = setTimeout(
          () =>
            rejectShutdown(
              new OwnedProcessShutdownError(`${label} output did not drain after launcher exit`, {
                confirmed: pipesClosed,
              }),
            ),
          1000,
        )
      }, rejectShutdown)
    })
    const closed = new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => {
        if (code === 0 || failure) resolve()
        else reject(new Error(`${label} exited ${code}: ${stderr}`))
      })
      const output = (data: string, error: boolean) => {
        bytes += Buffer.byteLength(data)
        if (bytes > maxBuffer) {
          stop(new Error(`${label} output exceeded ${maxBuffer} bytes`))
          return
        }
        if (error) stderr += data
        else stdout += data
      }
      child.stdout.setEncoding('utf8').on('data', (data: string) => output(data, false))
      child.stderr.setEncoding('utf8').on('data', (data: string) => output(data, true))
    })
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    const timeout = setTimeout(() => stop(new Error(`${label} timed out`)), timeoutMs)
    let outcome: { error: unknown } | undefined
    try {
      await Promise.race([closed, shutdownFailed])
      if (cleanup) await cleanup
      if (failure) throw failure
    } catch (error) {
      outcome = { error }
    } finally {
      clearTimeout(timeout)
      clearTimeout(pipeDeadline)
      signal?.removeEventListener('abort', aborted)
    }
    // Even an exited hook can leave descendants with redirected stdio writing this checkout.
    cleanup ??= stopOwnedChild(child)
    try {
      await cleanup
    } catch (error) {
      if (error instanceof OwnedProcessShutdownError) this.quarantineCheckout(ownedPath, error)
      this.audit?.(cwd, [command, ...args], { error: errorMessage(error) })
      throw error
    }
    if (outcome) {
      if (outcome.error instanceof OwnedProcessShutdownError) {
        this.quarantineCheckout(ownedPath, outcome.error)
      }
      this.audit?.(cwd, [command, ...args], { error: errorMessage(outcome.error) })
      throw outcome.error
    }
    this.audit?.(cwd, [command, ...args], {})
    return stdout
  }
  private quarantineCheckout(path: string, error: OwnedProcessShutdownError) {
    const pending = unconfirmedCheckoutCommands.get(path) ?? new Set<OwnedProcessShutdownError>()
    pending.add(error)
    unconfirmedCheckoutCommands.set(path, pending)
    void error.confirmed?.then(() => {
      pending.delete(error)
      if (!pending.size && unconfirmedCheckoutCommands.get(path) === pending)
        unconfirmedCheckoutCommands.delete(path)
    })
  }
  /** Preparation may fail before Tasks has admitted a provider and recorded its directories. */
  async assertCheckoutAvailable(path: string) {
    const canonical = await realpath(path)
    const error = unconfirmedCheckoutCommands.get(canonical)?.values().next().value
    if (error)
      throw new HttpError(
        409,
        `The checkout at ${canonical} is waiting for a previous command to confirm shutdown; its files were preserved.`,
      )
    // A linked checkout's Git lock survives runtime death. Only the preparation that owns
    // this exact reason may inspect/write it while its detached commands are still alive.
    const gitFile = join(canonical, '.git')
    const entry = await stat(gitFile).catch((cause: unknown) => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
      throw cause
    })
    if (!entry?.isFile()) return
    const gitDirectory = (await readFile(gitFile, 'utf8')).replace(/\r?\n$/, '')
    if (!gitDirectory.startsWith('gitdir: ')) return
    const lock = await readFile(
      join(resolve(canonical, gitDirectory.slice(8)), 'locked'),
      'utf8',
    ).catch((cause: unknown) => {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ENOENT') return undefined
      throw cause
    })
    const reason = lock?.replace(/\r?\n$/, '')
    if (
      reason &&
      /^(?:dovo-creating|dovo-preparing) /.test(reason) &&
      preparationOwnership.getStore()?.get(canonical) !== reason
    )
      throw new HttpError(
        409,
        `The checkout at ${canonical} has unfinished preparation (${reason}). Confirm its commands have stopped before unlocking its Git registration; files were preserved.`,
      )
  }
  async command(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
    const changesIdentity = changesRepositoryIdentity(args)
    // Config can be global or shared by linked worktrees. Fence reads on both sides
    // of a write, including partially failed writes; explicit refresh remains available.
    if (changesIdentity) this.identities.clear()
    try {
      return await this.run(cwd, this.settings().git, args, 30000, 12 * 1024 * 1024, env)
    } finally {
      if (changesIdentity) this.identities.clear()
    }
  }
  /** Bounded, interruptible reads for interactive project browsing and search. */
  readCommand(
    cwd: string,
    args: string[],
    limits: { signal?: AbortSignal; timeout?: number; maxBuffer?: number; input?: string } = {},
  ) {
    if (limits.input === undefined)
      return this.run(
        cwd,
        this.settings().git,
        args,
        limits.timeout ?? 5_000,
        limits.maxBuffer ?? 2 * 1024 * 1024,
        undefined,
        limits.signal,
      )
    const executable = this.settings().git
    this.audit?.(cwd, [executable, ...args])
    return new Promise<string>((resolve, reject) => {
      const child = execFile(
        executable,
        args,
        {
          cwd,
          env: processEnvironment(),
          windowsHide: true,
          signal: limits.signal,
          timeout: limits.timeout ?? 5_000,
          maxBuffer: limits.maxBuffer ?? 2 * 1024 * 1024,
        },
        (cause, stdout, stderr) => {
          if (cause) {
            this.audit?.(cwd, [executable, ...args], { error: cause.message })
            reject(
              new ProcessError({
                message: cause.message,
                cause,
                code: cause.code,
                signal: cause.signal,
                stdout,
                stderr,
              }),
            )
          } else {
            this.audit?.(cwd, [executable, ...args], {})
            resolve(stdout)
          }
        },
      )
      child.stdin?.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EPIPE') reject(error)
      })
      child.stdin?.end(limits.input)
    })
  }
  /** Git operations that write repository configuration shared by every linked worktree. */
  sharedConfigCommand(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
    return this.withSharedConfig(cwd, () => this.command(cwd, args, env))
  }
  async withSharedConfig<T>(
    cwd: string,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted()
    const common = (
      await this.command(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).replace(/\r?\n$/, '')
    const key = await realpath(common)
    const previous = sharedConfigWrites.get(key) ?? Promise.resolve()
    let release!: () => void
    const own = new Promise<void>((resolve) => {
      release = resolve
    })
    // A cancelled waiter must not let its successors pass the still-active earlier writer.
    const pending = previous.then(() => own)
    sharedConfigWrites.set(key, pending)
    void pending.then(() => {
      if (sharedConfigWrites.get(key) === pending) sharedConfigWrites.delete(key)
    })
    let held = false
    try {
      if (signal)
        await new Promise<void>((resolve, reject) => {
          const aborted = () => {
            signal.removeEventListener('abort', aborted)
            reject(signal.reason)
          }
          signal.addEventListener('abort', aborted, { once: true })
          if (signal.aborted) aborted()
          void previous.then(() => {
            signal.removeEventListener('abort', aborted)
            resolve()
          })
        })
      else await previous
      signal?.throwIfAborted()
      this.identities.clear()
      return await operation()
    } catch (error) {
      if (error instanceof OwnedProcessShutdownError) {
        // A rejected Stop is not proof that Git stopped writing shared config.
        held = true
        void error.confirmed?.then(release)
      }
      throw error
    } finally {
      this.identities.clear()
      if (!held) release()
    }
  }
  /** Copy project-local files only into freshly created checkouts, before setup runs. */
  async addWorktree(root: string, directory: string, args: string[], signal?: AbortSignal) {
    signal?.throwIfAborted()
    const version = await this.command(root, ['--version'])
    const parts = /git version (\d+)\.(\d+)/.exec(version)
    if (!parts || Number(parts[1]) < 2 || (Number(parts[1]) === 2 && Number(parts[2]) < 36))
      throw new HttpError(409, 'Git 2.36 or newer is required for safely owned worktree creation.')
    const files = await includedWorktreeFiles(root, signal)
    const reason = `dovo-creating ${randomUUID()}`
    await this.withSharedConfig(
      root,
      async () => {
        await this.assertCheckoutAvailable(root)
        // Git accepts an empty folder. Creating it exclusively gives us an identity before
        // checkout hooks run, so a confirmed cancellation can clean only this attempt.
        try {
          await mkdir(directory)
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
            throw new HttpError(
              409,
              `The checkout path ${directory} already exists; its files were preserved.`,
            )
          throw error
        }
        let identity: Awaited<ReturnType<typeof lstat>> | undefined
        let canonical: string | undefined
        const registration = async () => {
          const records = (await this.command(root, ['worktree', 'list', '--porcelain', '-z']))
            .split('\0\0')
            .map((block) => block.split('\0'))
          return records.find((record) => {
            const path = record.find((line) => line.startsWith('worktree '))?.slice(9)
            return path && canonical && resolve(path) === resolve(canonical)
          })
        }
        const owns = async () => (await registration())?.includes(`locked ${reason}`) ?? false
        try {
          canonical = await realpath(directory)
          identity = await lstat(canonical)
          await this.checkoutCommand(
            root,
            ['worktree', 'add', '--lock', '--reason', reason, ...args],
            signal,
          )
          signal?.throwIfAborted()
          const created = await lstat(canonical)
          if (created.dev !== identity.dev || created.ino !== identity.ino || !(await owns()))
            throw new HttpError(
              409,
              'The worktree registration changed during creation; its files were preserved.',
            )
          await copyWorktreeFiles(root, canonical, files, signal)
          signal?.throwIfAborted()
          const current = await lstat(canonical)
          if (current.dev !== identity.dev || current.ino !== identity.ino || !(await owns()))
            throw new HttpError(
              409,
              'The worktree changed during preparation; its files were preserved.',
            )
          if (this.worktreeCreated) {
            const common = (
              await this.command(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
            ).trim()
            this.worktreeCreated(common, canonical)
          }
          await this.command(root, ['worktree', 'unlock', canonical])
        } catch (error) {
          // Never clean while a process may still be writing or before identity was captured.
          if (error instanceof OwnedProcessShutdownError) throw error
          let cleaned = false
          if (canonical && identity) {
            const current = await lstat(canonical).catch(() => undefined)
            if (current?.dev === identity.dev && current.ino === identity.ino) {
              try {
                const record = await registration()
                // Keep the owned registration fenced if deleting the directory fails. Git's
                // own remove can erase the registration even when files could not be removed.
                if (record?.includes(`locked ${reason}`)) {
                  await rm(canonical, { recursive: true, maxRetries: 3, retryDelay: 100 })
                  await this.checkoutCommand(root, [
                    'worktree',
                    'remove',
                    '--force',
                    '--force',
                    canonical,
                  ])
                  cleaned = true
                } else {
                  // A failure before registration may leave our empty directory. Never recurse
                  // here: nonempty unregistered folders require explicit inspection.
                  await rmdir(canonical)
                  cleaned = true
                }
              } catch (cleanupError) {
                if (cleanupError instanceof OwnedProcessShutdownError) throw cleanupError
                throw new AggregateError(
                  [error, cleanupError],
                  `Worktree preparation failed; inspect ${directory} (${reason}).`,
                )
              }
            }
          }
          if (cleaned || signal?.aborted) throw error
          throw new HttpError(
            409,
            `${errorMessage(error)} Worktree preparation did not complete. Inspect ${directory} and its Git registration (${reason}) before retrying; existing files were preserved.`,
          )
        }
      },
      signal,
    )
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
      // Validate the selected GitHub account before initializing a local repository.
      const env = { ...processEnvironment(), ...(await this.githubEnvironment(cwd)) }
      await this.run(cwd, this.settings().gh, ['auth', 'status'], 30000, 1024 * 1024, env)
      if (!status.initialized) await this.command(cwd, ['init', '-b', 'main'])
      await this.withSharedConfig(cwd, () =>
        this.run(
          cwd,
          this.settings().gh,
          ['repo', 'create', name, `--${visibility}`, '--source', cwd, '--remote', 'origin'],
          60000,
          1024 * 1024,
          env,
        ),
      )
      return this.inspect(cwd)
    } finally {
      this.publishing.delete(cwd)
    }
  }
  async push(path: string, source?: NonNullable<Task['pullRequest']>) {
    const { path: cwd, branch } = await this.inspect(path)
    if (branch === 'detached HEAD') throw new HttpError(409, 'Check out a branch before pushing')
    const [remote, upstreamRef] = (
      await this.command(cwd, [
        'for-each-ref',
        '--format=%(upstream:remotename)%09%(upstream:remoteref)',
        `refs/heads/${branch}`,
      ])
    )
      .trim()
      .split('\t')
    if (remote === '.')
      throw new HttpError(
        409,
        'This branch tracks a local branch. Configure a remote upstream first.',
      )
    const remotes = remote ? [] : (await this.folderStatus(cwd)).remotes
    const destination =
      remote ||
      (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined)
    if (!destination)
      throw new HttpError(409, 'Choose a Git remote or create a GitHub repository before pushing')
    const ref = remote ? upstreamRef : `refs/heads/${branch}`
    const sourceUrl = source?.checkoutMode === 'pr-branch' ? source.headCloneUrl : undefined
    const authorization =
      sourceUrl && source?.connectionId
        ? await this.forgeAuthorization?.(source.connectionId, sourceUrl, cwd)
        : undefined
    const env: NodeJS.ProcessEnv = {
      ...this.nonInteractive(),
      ...(await this.githubEnvironment(cwd)),
      ...(sourceUrl ? this.remoteEnvironment(sourceUrl, authorization) : {}),
    }
    const host = env.GH_HOST || 'github.com'
    const gh = "'" + this.settings().gh.replaceAll("'", "'\"'\"'") + "'"
    await this.sharedConfigCommand(
      cwd,
      [
        '-c',
        `credential.https://${host}.helper=`,
        '-c',
        `credential.https://${host}.helper=!${gh} auth git-credential`,
        'push',
        '--set-upstream',
        '--',
        destination,
        `HEAD:${ref}`,
      ],
      env,
    )
  }
  private installedOpeners: Promise<InstalledOpener[]> | undefined
  async openTargets() {
    const installed = detectInstalledOpeners()
    this.installedOpeners = installed
    // Registered first, so a failed scan is uncached before any waiting open resumes.
    installed.catch(() => {
      if (this.installedOpeners === installed) this.installedOpeners = undefined
    })
    return { targets: (await installed).map((opener) => opener.target) }
  }
  async openFolder(path: string, target: RepositoryOpenTarget) {
    const cwd = await repositoryPath(path)
    return this.openDesktopPath(cwd, cwd, target)
  }
  async openFile(path: string, target: RepositoryOpenTarget) {
    return this.openDesktopPath(path, dirname(path), target)
  }
  private async openDesktopPath(path: string, cwd: string, target: RepositoryOpenTarget) {
    // A pending listing that fails must not fail this open; it rescans and reports its own error.
    const cached = await this.installedOpeners?.catch(() => undefined)
    const { executable, args, detached } = await folderOpenCommand(path, target, cached)
    if (!detached) {
      await this.run(cwd, executable, args, 10000, 1024 * 1024)
      return
    }
    this.audit?.(cwd, [executable, ...args])
    try {
      await launchDesktop(executable, args, cwd)
      this.audit?.(cwd, [executable, ...args], {})
    } catch (error) {
      this.audit?.(cwd, [executable, ...args], { error: errorMessage(error) })
      throw error
    }
  }
  private identities = new Map<
    string,
    { expires: number; pending: boolean; result: Promise<string | undefined> }
  >()
  private githubIdentityHosts = new Set<string>()
  /** Called only after the selected provider credential successfully verifies with GitHub. */
  confirmGithubHost(host: string) {
    if (this.githubIdentityHosts.has(host.toLowerCase())) return
    this.githubIdentityHosts.add(host.toLowerCase())
    this.identities.clear()
  }
  canonicalRepositoryIdentity(identity: string) {
    return this.githubIdentityHosts.has(identity.split('/')[0].toLowerCase()) ||
      this.repositoryProvider?.(identity) === 'github'
      ? identity.toLowerCase()
      : identity
  }
  repositoryIdentity(path: string, refresh = false) {
    const now = Date.now()
    const cached = this.identities.get(path)
    for (const [key, entry] of this.identities)
      if (key !== path && !entry.pending && entry.expires <= now) this.identities.delete(key)
    if (cached && !refresh && (cached.pending || cached.expires > now)) {
      this.identities.delete(path)
      this.identities.set(path, cached)
      return cached.result
    }
    const result = this.readRepositoryIdentity(path)
    const entry = { expires: now + 300000, pending: true, result }
    if (this.identities.size >= 256 && !this.identities.has(path))
      for (const [key, old] of this.identities) {
        if (old.pending) continue
        this.identities.delete(key)
        break
      }
    if (this.identities.size < 256 || this.identities.has(path)) this.identities.set(path, entry)
    result.then(
      () => {
        entry.pending = false
        // External Git/config/includeIf changes still converge without a watcher per
        // checkout; identity-sensitive writes explicitly refresh before proceeding.
        entry.expires = Date.now() + 300000
      },
      () => {
        // Keep a bounded unavailable state instead of alternating error/pending every snapshot.
        entry.pending = false
        entry.expires = Date.now() + 15000
      },
    )
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
    const identity = (remote: string) => {
      const raw = gitRemoteIdentity(remote)
      return raw ? this.canonicalRepositoryIdentity(raw) : undefined
    }
    const remotes = (await this.command(path, ['remote'])).trim().split('\n').filter(Boolean)
    // Prefer the clone's origin: merging every remote would incorrectly merge forks.
    if (remotes.includes('origin'))
      return identity(await this.command(path, ['remote', 'get-url', 'origin']))
    const identities = await Promise.all(
      remotes.map(async (name) => identity(await this.command(path, ['remote', 'get-url', name]))),
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
    await this.assertCheckoutAvailable(root)
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
      await this.command(
        root,
        ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'],
        { ...processEnvironment(), GIT_OPTIONAL_LOCKS: '0' },
      )
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
    const names = [...new Set(changed)]
    const old = hasHead
      ? await this.treeFiles(root, 'HEAD', names)
      : new Map<string, NonNullable<FilePreviewMetadata['before']>>()
    const files: ChangedFile[] = []
    let remaining = 1024 * 1024
    for (const name of names) {
      const before = old.get(name)
      let unreadable = false
      const after = await this.workingFile(root, name).catch(() => {
        unreadable = true
        return undefined
      })
      const sides = { before, after }
      const entries = [before, after].filter((side) => side !== undefined)
      let kind: FilePreviewMetadata['kind'] = entries.some((side) => side.mode === '160000')
        ? 'submodule'
        : entries.some((side) => side.mode === '120000')
          ? 'symlink'
          : entries.some((side) => side.size > 64 * 1024)
            ? 'large'
            : 'deferred'
      if (
        files.length < 200 &&
        !unreadable &&
        entries.length &&
        entries.every(
          (side) => side.mode !== '160000' && side.mode !== '120000' && side.size <= 64 * 1024,
        ) &&
        entries.reduce((sum, side) => sum + side.size, 0) <= remaining
      ) {
        try {
          const preview = await this.workingFilePreview(root, name, sides)
          if (
            [preview.before, preview.after].every(
              (side) => !side || (side.kind === 'text' && !side.truncated),
            )
          ) {
            const text = preview.after?.text ?? ''
            files.push({
              path: name,
              before: preview.before?.text ?? '',
              after: text,
              diskContents: text,
              viewed: false,
            })
            remaining -= entries.reduce((sum, side) => sum + side.size, 0)
            continue
          }
          kind = /\.(png|jpe?g|webp|gif|avif|tiff?|heic|ico)$/i.test(name) ? 'image' : 'binary'
        } catch {
          // Keep an unreadable or concurrently removed path visible; opening it reports the error.
        }
      }
      files.push({ path: name, before: '', after: '', viewed: false, preview: { kind, ...sides } })
    }
    return files
  }
  private async workingFile(root: string, name: string) {
    // Validate the parent without following the leaf: symlink targets are previewed as text.
    const parent = dirname(name)
    if (
      !name ||
      name.includes('\\') ||
      name.includes('\0') ||
      name.split('/').some((part) => part === '.git' || part === '..') ||
      ['.', '..'].includes(name)
    )
      throw new HttpError(400, 'Invalid file path')
    const file =
      parent === '.'
        ? join(root, basename(name))
        : join(await safeFile(root, parent), basename(name))
    const info = await lstat(file).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    })
    if (!info) return undefined
    if (!info.isFile() && !info.isSymbolicLink() && !info.isDirectory())
      throw new HttpError(400, 'This file type cannot be previewed.')
    if (info.isDirectory() && (await this.command(file, ['rev-parse', '--show-prefix'])).trim())
      throw new HttpError(400, 'This path is now a directory; select a file inside it.')
    const mode = info.isSymbolicLink()
      ? '120000'
      : info.isDirectory()
        ? '160000'
        : info.mode & 0o111
          ? '100755'
          : '100644'
    const hash = info.isDirectory()
      ? (await this.command(file, ['rev-parse', 'HEAD'])).trim()
      : 'working'
    return { hash, size: info.size, mode }
  }
  async workingFilePreview(
    root: string,
    name: string,
    metadata?: Pick<FilePreviewMetadata, 'before' | 'after'>,
    full = false,
    includePatch = false,
  ) {
    // Validate the requested working path before passing it to any Git command.
    const after = metadata ? undefined : await this.workingFile(root, name)
    const sides = metadata ?? {
      before: (
        await this.treeFiles(root, 'HEAD', [name]).catch(async (error) => {
          if ((await this.command(root, ['rev-list', '--all', '--count'])).trim() === '0')
            return new Map<string, NonNullable<FilePreviewMetadata['before']>>()
          throw error
        })
      ).get(name),
      after,
    }
    if (!sides.before && !sides.after)
      throw new HttpError(404, 'File is unavailable in the working checkout.')
    return createFilePreview(
      name,
      sides,
      async (hash, limit) => {
        if (hash !== 'working') return this.blobPrefix(root, hash, limit)
        // Revalidate before reading and never follow the final symlink as a regular file.
        const parent = dirname(name)
        const file =
          parent === '.'
            ? join(root, basename(name))
            : join(await safeFile(root, parent), basename(name))
        const info = await lstat(file)
        if (full && info.size !== sides.after?.size)
          throw new HttpError(409, 'The file changed while loading its diff. Reload and try again.')
        if (info.isSymbolicLink()) return Buffer.from(await readlink(file)).subarray(0, limit)
        const handle = await open(await safeFile(root, name), 'r')
        try {
          const bytes = Buffer.alloc(Math.min(limit, info.size))
          let offset = 0
          while (offset < bytes.length) {
            const result = await handle.read(bytes, offset, bytes.length - offset, offset)
            if (!result.bytesRead) break
            offset += result.bytesRead
          }
          if (full) {
            const current = await handle.stat()
            if (current.size !== info.size || current.mtimeMs !== info.mtimeMs)
              throw new HttpError(
                409,
                'The file changed while loading its diff. Reload and try again.',
              )
          }
          return bytes.subarray(0, offset)
        } finally {
          await handle.close()
        }
      },
      full,
      includePatch,
    )
  }

  // An alternate index captures staged and unstaged contents without touching the user's index.
  /** A private root commit for an isolated checkout; the source's unborn branch stays untouched. */
  async initialWorktreeCommit(cwd: string) {
    const directory = await mkdtemp(join(tmpdir(), 'dovo-empty-tree-'))
    try {
      const file = join(directory, 'empty')
      await writeFile(file, '')
      const tree = (await this.command(cwd, ['hash-object', '-t', 'tree', '-w', '--', file])).trim()
      return (
        await this.command(cwd, [
          '-c',
          'user.name=Dovo',
          '-c',
          'user.email=studio@dovo.local',
          '-c',
          'commit.gpgSign=false',
          'commit-tree',
          tree,
          '-m',
          'Initialize isolated task worktree',
        ])
      ).trim()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  async snapshot(cwd: string, ref: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
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
        this.checkoutCommand(cwd, args, signal, {
          ...processEnvironment(),
          GIT_INDEX_FILE: index,
        })
      await run(['add', '-A', '--', '.'])
      const tree = (await run(['write-tree'])).trim()
      signal?.throwIfAborted()
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
  async restoreSnapshot(
    cwd: string,
    target: string,
    backupRef: string,
    only?: string[],
    signal?: AbortSignal,
  ) {
    const current = await this.snapshot(cwd, backupRef, signal)
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
        this.checkoutCommand(cwd, args, signal, {
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
      for (const name of names) {
        signal?.throwIfAborted()
        if (!present.has(name))
          await rm(await safeFile(cwd, name, { followFinalSymlink: false }), { force: true })
      }
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
    before: string | undefined,
    after: string,
  ): Promise<{ files: ChangedFile[]; omitted: string[] }> {
    const names = (
      await this.command(
        cwd,
        before
          ? ['diff', '--name-only', '--no-renames', '-z', before, after, '--']
          : ['ls-tree', '-r', '--name-only', '-z', after, '--'],
      )
    )
      .split('\0')
      .filter(Boolean)
    const files: ChangedFile[] = []
    const trees = await Promise.all(
      [before, after].map(async (tree) =>
        tree
          ? this.treeFiles(cwd, tree, names)
          : new Map<string, NonNullable<FilePreviewMetadata['before']>>(),
      ),
    )
    // These limits bound embedded previews, never the list of saved files.
    let remaining = 1024 * 1024
    let previews = 0
    return this.withBlobs(cwd, async (blobs) => {
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
            const content = side ? await blobs.text(side.hash, side.size) : ''
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
    })
  }
  private async withBlobs<T>(cwd: string, read: (blobs: GitBlobReader) => Promise<T>): Promise<T> {
    const args = [this.settings().git, 'cat-file', '--batch']
    let started = false
    const blobs = new GitBlobReader(args[0], cwd, undefined, () => {
      started = true
      this.audit?.(cwd, args)
    })
    try {
      const result = await read(blobs)
      if (started) this.audit?.(cwd, args, {})
      return result
    } catch (error) {
      if (started) this.audit?.(cwd, args, { error: errorMessage(error) })
      throw error
    } finally {
      await blobs.close()
    }
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
  async checkpointFilePreview(
    cwd: string,
    before: string | undefined,
    after: string,
    path: string,
    full = false,
    includePatch = false,
  ) {
    const sides = await Promise.all(
      [before, after].map(async (tree) =>
        tree
          ? this.treeFiles(cwd, tree, [path])
          : new Map<string, NonNullable<FilePreviewMetadata['before']>>(),
      ),
    )
    const old = sides[0].get(path),
      next = sides[1].get(path)
    if (!old && !next) throw new HttpError(404, 'This file is not in the saved snapshots.')
    return createFilePreview(
      path,
      { before: old, after: next },
      (hash, limit) => this.blobPrefix(cwd, hash, limit),
      full,
      includePatch,
    )
  }
  /** Read a bounded prefix without buffering the rest of a potentially huge saved blob. */
  private blobPrefix(cwd: string, hash: string, limit: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.settings().git, ['cat-file', 'blob', hash], {
        windowsHide: true,
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

  /** Committed changes on this branch since its merge base with its recorded or default base. */
  async branchChangesFiles(cwd: string, recorded?: BranchBase) {
    const { before, after, base } = await this.branchTrees(cwd, recorded)
    return { ...(await this.checkpointChanges(cwd, before, after)), base, before, after }
  }
  /** Whole branch against the merge base, including staged, unstaged and untracked files. */
  async reviewBranchChangesFiles(cwd: string, recorded?: BranchBase) {
    const { before, base } = await this.branchTrees(cwd, recorded)
    const after = await this.snapshot(cwd, 'refs/dovo/reviews/branch-preview')
    return { ...(await this.checkpointChanges(cwd, before, after)), base, before, after }
  }
  /** A recorded base applies only while its branch is checked out: its ref first, then the
   * commit the branch started from once that ref is deleted. Otherwise the default branch is
   * used. The checked-out branch is never its own base: comparing it finds no changes. */
  async branchTrees(cwd: string, recorded?: BranchBase) {
    const head = (await this.command(cwd, ['rev-parse', '--verify', 'HEAD'])).trim()
    const current = (await this.command(cwd, ['symbolic-ref', '-q', 'HEAD']).catch(() => '')).trim()
    const commit = async (ref: string) =>
      (
        await this.command(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(
          () => '',
        )
      ).trim()
    const ancestor = (base: string) =>
      this.command(cwd, ['merge-base', base, head]).then(
        (value) => value.trim(),
        () => '',
      )
    if (recorded && (!recorded.branch || current === `refs/heads/${recorded.branch}`)) {
      for (const base of [recorded.ref, recorded.commit]) {
        if (!base || base === current || `refs/heads/${base}` === current) continue
        const before = (await commit(base)) && (await ancestor(base))
        if (before) return { before, after: head, base }
      }
    }
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
    ]
      .filter(Boolean)
      // Prefer another branch; comparing a default branch with itself just finds no changes.
      .sort((a, b) => Number(a === current) - Number(b === current))
    let base: string | undefined
    for (const candidate of candidates) {
      if (await commit(candidate)) {
        base = candidate
        break
      }
    }
    if (!base)
      throw new HttpError(
        409,
        'No default branch was found. Set origin/HEAD or create a main or master branch.',
      )
    const before = (await this.command(cwd, ['merge-base', base, head])).trim()
    return { before, after: head, base }
  }
  async save(path: string, name: string, expected: string, contents: string) {
    const { path: root } = await this.inspect(path)
    const full = await safeFile(root, name)
    return withFileWrite(full, async () => {
      // Compare after admission: another Studio client may have applied a draft while
      // this operation waited. External editors continue to own their own writes.
      const target = await safeFile(root, name)
      let current = ''
      try {
        current = await readFile(target, 'utf8')
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
      if (current !== expected)
        throw new HttpError(409, 'File changed on disk. Refresh before applying your draft.')
      await writeFile(target, contents)
    })
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
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted()
    const fetch = (args: string[], env: NodeJS.ProcessEnv, timeout = 60000) =>
      signal
        ? this.checkoutCommand(cwd, args, signal, env, timeout)
        : this.run(cwd, this.settings().git, args, timeout, 12 * 1024 * 1024, env)
    // Only disposable Studio attribute refs may move backwards after a force-push.
    const refspec = (head: string) =>
      `${ref.startsWith('refs/dovo/pull-attributes/') ? '+' : ''}${head}:${ref}`
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
      await fetch(
        [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--',
          source.cloneUrl,
          refspec(source.headRef),
        ],
        this.remoteEnvironment(source.cloneUrl, authorization),
      )
      return
    }
    const remote = `${repositoryUrl.replace(/\/$/, '')}.git`
    const authorization = source?.connectionId
      ? await this.forgeAuthorization?.(source.connectionId, remote, cwd)
      : undefined
    if (authorization) {
      await fetch(
        [
          'fetch',
          '--no-tags',
          '--no-write-fetch-head',
          '--',
          remote,
          refspec(`refs/pull/${number}/head`),
        ],
        this.remoteEnvironment(remote, authorization),
      )
      return
    }
    const gh = "'" + this.settings().gh.replaceAll("'", "'\"'\"'") + "'"
    await fetch(
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
        refspec(`refs/pull/${number}/head`),
      ],
      this.nonInteractive(),
      30000,
    )
  }
  private githubRepositories = new Map<
    string,
    { expires: number; pending: boolean; result: Promise<string> }
  >()
  async github(path: string, args: string[], background = false) {
    const { path: cwd, branch } = await this.inspect(path)
    const env: NodeJS.ProcessEnv = {
      ...processEnvironment(),
      ...(await this.githubEnvironment(cwd)),
    }
    const load = (host?: string) =>
      this.githubRequest(
        cwd,
        args,
        60000,
        32 * 1024 * 1024,
        env,
        background,
        undefined,
        undefined,
        undefined,
        host,
      )
    if (args[0] === 'api' || args[0] === 'auth') return load()
    // Resolve CLI credentials on the checkout's host, including non-origin and resolved remotes.
    // Discovery keys include effective Git config, environment, executable and credential;
    // none of their values enter diagnostics.
    const config = await this.command(cwd, ['config', '--null', '--list'])
    const configured = config.split('\0')
    const remotes = configured.filter((value) => /^remote\..+\.url\n/.test(value))
    const resolved = configured
      .find((value) => /^remote\..+\.gh-resolved\nbase$/.test(value))
      ?.split('\n')[0]
      ?.replace(/\.gh-resolved$/, '.url')
    const preferred =
      remotes.find((value) => value.startsWith(`${resolved}\n`)) ??
      remotes.find((value) => value.startsWith('remote.origin.url\n'))
    const hosts = [
      ...new Set(
        remotes
          .map((value) => gitRemoteIdentity(value.split('\n')[1] ?? '')?.split('/')[0])
          .filter((host) => host !== undefined),
      ),
    ]
    const selectedRemote = preferred ?? (hosts.length === 1 ? remotes[0] : undefined)
    // Ask Git to apply url.*.insteadOf rewrites before choosing a credential host.
    const remoteName = selectedRemote?.split('\n')[0]?.slice('remote.'.length, -'.url'.length)
    const effectiveRemote = remoteName
      ? await this.command(cwd, ['remote', 'get-url', remoteName])
      : undefined
    const override = env.GH_REPO
    const host =
      (override
        ? (gitRemoteIdentity(override)?.split('/')[0] ??
          (override.split('/').length === 3 ? override.split('/')[0] : undefined))
        : undefined) ??
      env.GH_HOST ??
      (effectiveRemote ? gitRemoteIdentity(effectiveRemote)?.split('/')[0] : undefined) ??
      (preferred ? gitRemoteIdentity(preferred.split('\n')[1] ?? '')?.split('/')[0] : undefined) ??
      (hosts.length === 1 ? hosts[0] : undefined) ??
      'github.com'
    if (args.join(' ') !== 'repo view --json nameWithOwner,url') return load(host)
    const token = await this.githubCredentials.token(host, cwd, env)
    const key = createHash('sha256')
      .update(JSON.stringify([cwd, branch, config, env, token, this.settings().gh]))
      .digest('hex')
    const cached = this.githubRepositories.get(key)
    if (cached && (cached.pending || cached.expires > Date.now())) return cached.result
    const result = load(host)
      .then((text) => {
        decode(
          mutableStruct({ nameWithOwner: Schema.String, url: Schema.String }),
          JSON.parse(text),
        )
        return text
      })
      .catch((error: unknown) => {
        // Unchanged local configuration and credentials still identify the same checkout.
        // Retain that metadata during throttling so REST pipeline reads can continue.
        if (cached && error instanceof HttpError && error.status === 429) return cached.result
        throw error
      })
    const entry = { expires: Date.now() + 600_000, pending: true, result }
    this.githubRepositories.set(key, entry)
    if (this.githubRepositories.size > 256)
      for (const [oldKey, old] of this.githubRepositories) {
        if (!old.pending) this.githubRepositories.delete(oldKey)
        if (this.githubRepositories.size <= 256) break
      }
    result.then(
      () => {
        entry.pending = false
        entry.expires = Date.now() + 600_000
      },
      () => {
        if (this.githubRepositories.get(key) === entry) this.githubRepositories.delete(key)
      },
    )
    return result
  }

  /** Capture the actual credential once so identity verification and dispatch use the same login. */
  async githubCredential(
    cwd: string,
    host: string,
    env?: Record<string, string>,
    refresh = false,
  ): Promise<GithubAccount> {
    const context = { ...processEnvironment(), ...(env ?? (await this.githubEnvironment(cwd))) }
    if (refresh) this.githubCredentials.invalidate(host, cwd, context)
    const credential = await this.githubCredentials.capture(host, cwd, context)
    return {
      host,
      ...credential,
      access: { host, source: credential.source },
      ...(env ? { env } : {}),
    }
  }
  async githubAccount(
    args: string[],
    limits?: {
      timeout: number
      maxBuffer: number
    },
    cwd?: string,
    account?: GithubAccount,
    background = false,
    input?: string,
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
        ...(account ? account.env : cwd ? await this.githubEnvironment(cwd) : {}),
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
      background,
      input,
      account?.onUnauthorized,
      account?.beforeDispatch,
      undefined,
      account?.access,
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
          number: Schema.Number.pipe(Schema.check(Schema.isFinite())),
          title: Schema.String,
          url: Schema.String.pipe(Schema.decodeTo(urlSchema())),
          state: Schema.String,
          headRefName: Schema.String,
        }),
      ),
      JSON.parse(result),
    )
  }
}
