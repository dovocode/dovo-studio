import {
  execFile,
  type ExecFileOptions,
  type ExecFileOptionsWithBufferEncoding,
  type ExecFileOptionsWithStringEncoding,
} from 'node:child_process'
import { Data, Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'

export class ProcessError extends Data.TaggedError('ProcessError')<{
  readonly message: string
  readonly cause: Error
  readonly code?: string | number
  readonly signal?: NodeJS.Signals | null
  readonly stdout: string | Buffer
  readonly stderr: string | Buffer
}> {}
type Output<A> = { stdout: A; stderr: A }

export function execEffect(
  command: string,
  args: readonly string[],
  options: ExecFileOptionsWithBufferEncoding,
): Effect.Effect<Output<Buffer>, ProcessError>
export function execEffect(
  command: string,
  args?: readonly string[],
  options?: ExecFileOptionsWithStringEncoding,
): Effect.Effect<Output<string>, ProcessError>
export function execEffect(
  command: string,
  args: readonly string[] = [],
  options: ExecFileOptions = {},
): Effect.Effect<Output<string | Buffer>, ProcessError> {
  return Effect.async((resume) => {
    const child = execFile(command, [...args], options, (cause, stdout, stderr) => {
      resume(
        cause
          ? Effect.fail(
              new ProcessError({
                message: cause.message,
                cause,
                code: cause.code,
                signal: cause.signal,
                stdout,
                stderr,
              }),
            )
          : Effect.succeed({ stdout, stderr }),
      )
    })
    // Interruption must wait for the native process to exit before releasing its
    // parent scope; a canceled command may not keep writing into a closed runtime.
    return Effect.async<void>((done) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null)
        return done(Effect.void)
      child.once('close', () => done(Effect.void))
      child.kill('SIGKILL')
    })
  })
}

export function exec(
  command: string,
  args: readonly string[],
  options: ExecFileOptionsWithBufferEncoding,
): Promise<Output<Buffer>>
export function exec(
  command: string,
  args?: readonly string[],
  options?: ExecFileOptionsWithStringEncoding,
): Promise<Output<string>>
export function exec(
  command: string,
  args: readonly string[] = [],
  options: ExecFileOptions = {},
): Promise<Output<string | Buffer>> {
  if (options.encoding === 'buffer' || options.encoding === null)
    return runClientEffect(execEffect(command, args, { ...options, encoding: options.encoding }))
  const encoding = options.encoding ?? 'utf8'
  if (!Buffer.isEncoding(encoding))
    return Promise.reject(new TypeError(`Unknown encoding: ${encoding}`))
  return runClientEffect(execEffect(command, args, { ...options, encoding }))
}

export function processEnvironment() {
  const env = { ...process.env }
  delete env.DOVO_OWNER_TOKEN
  delete env.ELECTRON_RUN_AS_NODE
  for (const key of [
    'GH_REPO',
    'GH_HOST',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_PREFIX',
  ])
    delete env[key]
  return env
}
export const executableAvailableEffect = (command: string) =>
  execEffect(command, ['--version'], {
    timeout: 5000,
    env: processEnvironment(),
    maxBuffer: 1024 * 1024,
  }).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  )
export const executableAvailable = (command: string) =>
  runClientEffect(executableAvailableEffect(command))
