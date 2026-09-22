import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { processEnvironment } from '../process.js'
import { HttpError } from '../errors.js'
// Deliberately bypass command/activity logging: CLI output may contain credentials.
export async function runForgeCli(
  executable: string,
  args: string[],
  input?: unknown,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return (await captureForgeCli(executable, args, input, cwd, env)).stdout
}
export function captureForgeCli(
  executable: string,
  args: string[],
  input?: unknown,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return captureCliOutput(
    executable,
    args,
    input === undefined ? undefined : JSON.stringify(input),
    cwd,
    env,
  )
}
export async function runForgeCliText(
  executable: string,
  args: string[],
  input: string,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
) {
  return (await captureCliOutput(executable, args, input, cwd, env)).stdout
}
function captureCliOutput(
  executable: string,
  args: string[],
  input?: string,
  cwd?: string,
  env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
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
            'The source control CLI timed out. Check authentication on the runtime host; refresh before retrying a write.',
          ),
        ),
      60000,
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
