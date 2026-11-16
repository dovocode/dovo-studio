import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { exec, processEnvironment } from '../process.js'

export type ContainerCliKind = 'docker' | 'podman'
export interface ContainerCli {
  kind: ContainerCliKind
  command: string
  /** Rootless Docker maps container root to the host user; other users map to sub-IDs. */
  rootless: boolean
}
export type CliRunner = (
  command: string,
  args: readonly string[],
  options?: { input?: string; timeout?: number; onLine?: (line: string) => void },
) => Promise<{ stdout: string; stderr: string; code: number }>

class ContainerCommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly code: number,
  ) {
    super(message)
  }
}

/** Run a container CLI command, streaming lines when asked, and resolve with its exit code. */
export const runCli: CliRunner = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      env: processEnvironment(),
      stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = '',
      stderr = '',
      pending = ''
    const line = (text: string) => {
      if (!options.onLine) return
      pending += text
      const lines = pending.split(/\r?\n|\r/)
      pending = lines.pop() ?? ''
      for (const item of lines) if (item.trim()) options.onLine(item)
    }
    child.stdout?.setEncoding('utf8').on('data', (text: string) => {
      stdout = (stdout + text).slice(-1024 * 1024)
      line(text)
    })
    child.stderr?.setEncoding('utf8').on('data', (text: string) => {
      stderr = (stderr + text).slice(-1024 * 1024)
      line(text)
    })
    const timer = options.timeout
      ? setTimeout(() => child.kill('SIGKILL'), options.timeout)
      : undefined
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (pending.trim()) options.onLine?.(pending)
      resolve({ stdout, stderr, code: code ?? 1 })
    })
    if (options.input !== undefined) child.stdin?.end(options.input)
  })

/** Run and fail with the command's own error output. */
export async function runChecked(
  runner: CliRunner,
  command: string,
  args: readonly string[],
  options?: Parameters<CliRunner>[2],
) {
  const result = await runner(command, args, options)
  if (result.code !== 0)
    throw new ContainerCommandError(
      (result.stderr.trim() || result.stdout.trim() || `${command} ${args[0]} failed`).slice(-2000),
      result.stdout,
      result.stderr,
      result.code,
    )
  return result
}

export const sandboxSetupMessage =
  'Install Docker (Docker Desktop on macOS, Docker Engine on Linux) or Podman, start it, and make sure the user that runs Dovo can use it without sudo. Then send the message again.'

/** Find a working container CLI. Docker comes first; Podman works through the same commands. */
export async function detectContainerCli(
  runner: CliRunner = (command, args, options) =>
    exec(command, args, { timeout: options?.timeout ?? 10000, env: processEnvironment() }).then(
      (result) => ({ ...result, code: 0 }),
      (error: unknown) => ({
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        code: 1,
      }),
    ),
): Promise<{ cli?: ContainerCli; message?: string }> {
  if (process.platform === 'win32')
    return { message: 'Sandboxes need a Linux or macOS runtime host in this version.' }
  if (existsSync('/.dockerenv') || existsSync('/run/.containerenv'))
    return {
      message:
        'This Dovo runtime runs inside a container. Sandboxes need the runtime on the host in this version. See docs/sandboxes.md.',
    }
  const failures: string[] = []
  for (const kind of ['docker', 'podman'] as const) {
    // Docker and Podman report different `info` templates; plain output works for both.
    const result = await runner(kind, ['info'], { timeout: 10000 })
    if (result.code === 0)
      return {
        cli: {
          kind,
          command: kind,
          rootless: kind === 'docker' && /^\s*rootless\s*$/m.test(result.stdout),
        },
      }
    failures.push(`${kind}: ${result.stderr.trim().split('\n')[0] ?? 'not available'}`)
  }
  return { message: `${sandboxSetupMessage} (${failures.join('; ')})`.slice(0, 2000) }
}
