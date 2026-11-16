import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { decode, mutableStruct, type PullCodeReview } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { errorMessage } from '../../errors.js'
import { processEnvironment } from '../../process.js'
import {
  OwnedProcessShutdownError,
  stopOwnedChild,
} from '../../agents/execution/stop-owned-child.js'

type Check = NonNullable<PullCodeReview['checks']>[number]
const manifestSchema = mutableStruct({
  packageManager: Schema.optional(Schema.String),
  scripts: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const groups = [
  ['build'],
  ['check'],
  ['typecheck'],
  ['lint'],
  ['fallow:ci', 'fallow'],
  ['test:ci', 'test'],
]

/** Only installed, known package managers and fixed script names become executable arguments. */
export function pullCheckCommands(manifest: typeof manifestSchema.Type, lockfiles: string[]) {
  const declared = manifest.packageManager?.split('@')[0]
  const manager =
    declared ??
    (lockfiles.includes('pnpm-lock.yaml')
      ? 'pnpm'
      : lockfiles.includes('yarn.lock')
        ? 'yarn'
        : lockfiles.some((file) => /^bun\.lockb?$/.test(file))
          ? 'bun'
          : 'npm')
  if (!['pnpm', 'npm', 'yarn', 'bun'].includes(manager))
    throw new Error(`Unsupported package manager: ${manager}`)
  const yarnModern =
    manager === 'yarn' && Number(manifest.packageManager?.split('@')[1]?.split('.')[0] ?? 1) >= 2
  const install =
    manager === 'npm'
      ? ['ci']
      : manager === 'yarn' && yarnModern
        ? ['install', '--immutable']
        : ['install', '--frozen-lockfile']
  return {
    manager,
    install,
    scripts: groups.map((names) => ({
      name: names[0],
      script: names.find((name) => !!manifest.scripts?.[name]?.trim()),
    })),
  }
}

export async function runPullCheckCommand(
  command: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  timeout = 300_000,
): Promise<Pick<Check, 'status' | 'output' | 'exitCode'>> {
  signal.throwIfAborted()
  const child = spawn(command, args, {
    cwd,
    env: processEnvironment({ CI: 'true', FORCE_COLOR: '0', GIT_TERMINAL_PROMPT: '0' }),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
    // Windows package managers are .cmd launchers. All arguments here are fixed by Dovo.
    shell: process.platform === 'win32',
  })
  let output = ''
  let timedOut = false
  let shutdown: Promise<void> | undefined
  const stop = () => {
    shutdown ??= stopOwnedChild(child)
    void shutdown.catch(() => undefined)
  }
  const timer = setTimeout(() => {
    timedOut = true
    stop()
  }, timeout)
  signal.addEventListener('abort', stop, { once: true })
  const append = (data: string) => {
    output += data
    if (output.length > 20_000)
      output = output.slice(0, 8000) + '\n[Output truncated]\n' + output.slice(-11_000)
  }
  child.stdout.setEncoding('utf8').on('data', append)
  child.stderr.setEncoding('utf8').on('data', append)
  try {
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', resolve)
    })
    return {
      status: signal.aborted
        ? 'cancelled'
        : timedOut
          ? 'timed-out'
          : exitCode === 0
            ? 'passed'
            : 'failed',
      output,
      ...(exitCode !== null ? { exitCode } : {}),
    }
  } catch (error) {
    return {
      status: signal.aborted ? 'cancelled' : 'failed',
      output: (output + '\n' + errorMessage(error)).slice(-20_000),
    }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    // Also stop descendants left by a command which exited successfully.
    await (shutdown ?? stopOwnedChild(child))
  }
}

/** Temporary checkout isolation preserves user files. It is NOT a security sandbox. */
export async function runPullChecks({
  repository,
  headSha,
  git,
  signal,
  progress,
}: {
  repository?: string
  headSha: string
  git: Services['git']
  signal: AbortSignal
  progress: (checks: Check[]) => void
}): Promise<Check[]> {
  const checks: Check[] = []
  const update = () => progress(structuredClone(checks))
  const skip = (name: string, output: string) => {
    checks.push({ name, command: '', headSha, status: 'skipped', output })
    update()
  }
  if (!repository) {
    skip('Project checks', 'A local Git project with the captured PR commit is required.')
    return checks
  }
  const directory = await mkdtemp(join(tmpdir(), 'dovo-pr-checks-'))
  const checkout = join(directory, 'checkout')
  let preserve = false
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20 * 60_000)])
  const run = async (name: string, command: string, args: string[]) => {
    bounded.throwIfAborted()
    const check: Check = {
      name,
      command: [command, ...args].join(' '),
      headSha,
      status: 'running',
      output: '',
      startedAt: new Date().toISOString(),
    }
    checks.push(check)
    update()
    try {
      Object.assign(check, await runPullCheckCommand(command, args, checkout, bounded))
      if (bounded.aborted && !signal.aborted) check.status = 'timed-out'
      if (
        !bounded.aborted &&
        (await git.readCommand(checkout, ['rev-parse', 'HEAD'], { signal: bounded })).trim() !==
          headSha
      ) {
        check.status = 'failed'
        check.output = (
          check.output +
          '\nThe command changed the checkout commit. Results cannot verify the captured PR commit.'
        ).slice(-20000)
        throw new Error('The verification checkout commit changed. Later commands did not run.')
      }
    } catch (error) {
      check.status = 'failed'
      check.output = (check.output + '\n' + errorMessage(error)).slice(-20000)
      throw error
    } finally {
      if (check.status === 'running') {
        check.status = 'failed'
        check.output = 'Command shutdown was not confirmed.'
      }
      check.finishedAt = new Date().toISOString()
      update()
    }
    return check.status === 'passed'
  }
  try {
    if (!/^[a-f0-9]{40,64}$/i.test(headSha)) throw new Error('Invalid captured PR commit.')
    await git.readCommand(repository, ['cat-file', '-e', `${headSha}^{commit}`], {
      signal: bounded,
    })
    // A fresh clone has no PR-controlled Git settings and no link to user working files.
    await git.readCommand(
      repository,
      [
        '-c',
        'core.hooksPath=',
        'clone',
        '--shared',
        '--no-checkout',
        '--no-hardlinks',
        '--',
        repository,
        checkout,
      ],
      { signal: bounded, timeout: 60_000 },
    )
    await git.readCommand(
      checkout,
      [
        '-c',
        'core.hooksPath=',
        '-c',
        'filter.lfs.smudge=',
        '-c',
        'filter.lfs.process=',
        '-c',
        'filter.lfs.required=false',
        'checkout',
        '--detach',
        headSha,
      ],
      {
        signal: bounded,
        timeout: 60_000,
      },
    )
    if (
      (await git.readCommand(checkout, ['rev-parse', 'HEAD'], { signal: bounded })).trim() !==
      headSha
    )
      throw new Error('The verification checkout does not match the captured PR commit.')
    if (!(await lstat(join(checkout, 'package.json'))).isFile())
      throw new Error('A regular root package.json is required for automatic project checks.')
    const manifest = decode(
      manifestSchema,
      JSON.parse(await readFile(join(checkout, 'package.json'), 'utf8')),
    )
    const lockfiles: string[] = []
    for (const file of [
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lock',
      'bun.lockb',
      'package-lock.json',
    ]) {
      try {
        if ((await lstat(join(checkout, file))).isFile()) lockfiles.push(file)
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
    }
    const plan = pullCheckCommands(manifest, lockfiles)
    if (!plan.scripts.some((item) => item.script)) {
      skip(
        'Project checks',
        'No supported root check, typecheck, lint, Fallow or test scripts were found.',
      )
      return checks
    }
    const installed = await run('Install dependencies', plan.manager, plan.install)
    for (const { name, script } of plan.scripts) {
      bounded.throwIfAborted()
      if (!script) {
        skip(name, 'No matching root package script.')
        continue
      }
      if (!installed) {
        skip(name, 'Dependency installation did not pass.')
        continue
      }
      await run(name, plan.manager, ['run', script])
    }
  } catch (error) {
    if (error instanceof OwnedProcessShutdownError) preserve = true
    skip(
      'Project checks',
      `${errorMessage(error)}${preserve ? ` Temporary files were kept at ${directory} because process shutdown was not confirmed.` : ''}`,
    )
  } finally {
    if (!preserve) await rm(directory, { recursive: true, force: true })
  }
  return checks
}
