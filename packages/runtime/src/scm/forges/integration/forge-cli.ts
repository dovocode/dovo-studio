import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { basename } from 'node:path'
import { processEnvironment } from '../../../process.js'
import { HttpError } from '../../../errors.js'
/** Account and profile probes answer in seconds or not at all; data requests may take longer. */
export const FORGE_CLI_PROBE_TIMEOUT = 15000
export const FORGE_CLI_TIMEOUT = 60000
/** Login status, token and profile lookups across gh, bb, tea, fj and az. */
const probeCommands = new Set(['auth', 'profile', 'logins', 'login', 'whoami', 'account'])
export function forgeCliTimeout(args: readonly string[]) {
  return args.some((arg) => probeCommands.has(arg)) ? FORGE_CLI_PROBE_TIMEOUT : FORGE_CLI_TIMEOUT
}
// Deliberately bypass command/activity logging: CLI output may contain credentials.
export async function runForgeCli(
  executable: string,
  args: string[],
  input?: unknown,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  timeout = forgeCliTimeout(args),
): Promise<string> {
  return (await captureForgeCli(executable, args, input, cwd, env, timeout)).stdout
}
export function captureForgeCli(
  executable: string,
  args: string[],
  input?: unknown,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  timeout = forgeCliTimeout(args),
): Promise<{ stdout: string; stderr: string }> {
  return captureCliOutput(
    executable,
    args,
    input === undefined ? undefined : JSON.stringify(input),
    cwd,
    env,
    timeout,
  )
}
export async function runForgeCliText(
  executable: string,
  args: string[],
  input: string,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  timeout = forgeCliTimeout(args),
) {
  return (await captureCliOutput(executable, args, input, cwd, env, timeout)).stdout
}
/** The command a timeout names: the executable and its first words, never field values. */
export function forgeCliLabel(executable: string, args: readonly string[]) {
  return [basename(executable), ...args.slice(0, 3).filter((arg) => !arg.startsWith('-'))].join(' ')
}
function captureCliOutput(
  executable: string,
  args: string[],
  input?: string,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
  timeout = FORGE_CLI_TIMEOUT,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      cwd: cwd ?? homedir(),
      env: {
        ...processEnvironment(),
        ...env,
        GH_PROMPT_DISABLED: '1',
        AZURE_CORE_ONLY_SHOW_ERRORS: 'true',
        NO_COLOR: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const output: Buffer[] = [],
      errors: Buffer[] = []
    let size = 0,
      settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        child.kill('SIGKILL')
        reject(error)
      } else
        resolve({
          stdout: Buffer.concat(output).toString('utf8'),
          stderr: Buffer.concat(errors).toString('utf8'),
        })
    }
    const timer = setTimeout(
      () =>
        finish(
          new HttpError(
            504,
            `${forgeCliLabel(executable, args)} did not answer within ${Math.round(timeout / 1000)} seconds. A pending keychain or sign-in prompt on the runtime host can hold it; check authentication there and refresh before retrying a write.`,
          ),
        ),
      timeout,
    )
    child.on('error', () =>
      finish(
        new HttpError(
          502,
          'Could not start the source control CLI. Check its executable in runtime settings.',
        ),
      ),
    )
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024 * 1024)
        finish(new HttpError(502, 'The CLI response exceeded 16 MB. Open the item on its server.'))
      else output.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 16 * 1024 * 1024) finish(new HttpError(502, 'The CLI response exceeded 16 MB'))
      else errors.push(chunk)
    })
    child.stdin.on('error', () => {
      /* Process exit reports a failed request without echoing private input. */
    })
    child.on('close', (code) =>
      finish(
        code === 0
          ? undefined
          : new HttpError(
              502,
              'The source control CLI rejected the request. Check host, login, permissions and submitted fields. Refresh before retrying a write.',
            ),
      ),
    )
    child.stdin.end(input)
  })
}
