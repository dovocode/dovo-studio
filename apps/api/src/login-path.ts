import { execFile, execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const marker = '__DOVO_LOGIN_PATH__'
const pathArgs = ['-ilc', `printf '${marker}%s${marker}' "$PATH"`]
const shellFor = (env: NodeJS.ProcessEnv) =>
  env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
const markedPath = (output: string) =>
  new RegExp(`${marker}(.*?)${marker}`, 's').exec(output)?.[1] || undefined

/** Apps started from the Dock or launchd get a minimal PATH (/usr/bin:/bin:…), so CLIs installed
 * with mise, Homebrew or npm (codex, claude, gh) are missing and agent turns fail at spawn. Ask
 * the user's login shell once, the way editors do. Failures and slow shells fall back quietly. */
export function loginShellPath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (process.platform === 'win32') return undefined
  try {
    const output = execFileSync(shellFor(env), pathArgs, {
      encoding: 'utf8',
      timeout: 5000,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    // Shell startup files may print banners; only the marked value is trusted.
    return markedPath(output)
  } catch {
    return undefined
  }
}

/** Re-read only PATH. Running providers keep the environment they inherited at launch. */
export function refreshableLoginPath(env: NodeJS.ProcessEnv = process.env) {
  const initial = env.PATH
  let login = loginShellPath(env)
  const update = () => {
    if (process.platform !== 'win32')
      env.PATH = mergePath(initial, login, knownToolDirectories(env))
  }
  update()
  let pending: Promise<void> | undefined
  return () => {
    if (process.platform === 'win32') return Promise.resolve()
    pending ??= new Promise<void>((resolve) => {
      execFile(
        shellFor(env),
        pathArgs,
        {
          env: { ...env, PATH: initial },
          timeout: 5000,
          maxBuffer: 1024 * 1024,
          encoding: 'utf8',
        },
        (error, output) => {
          if (!error) login = markedPath(output) ?? login
          update()
          resolve()
        },
      ).stdin?.end()
    }).finally(() => {
      pending = undefined
    })
    return pending
  }
}

/** Version managers such as mise add their paths from a prompt hook, which a one-off login
 * shell never runs. Include the standard install locations that exist on this machine. */
export function knownToolDirectories(env: NodeJS.ProcessEnv = process.env) {
  if (process.platform === 'win32' || !env.HOME) return []
  const home = env.HOME
  return [
    join(env.MISE_DATA_DIR ?? join(home, '.local/share/mise'), 'shims'),
    join(home, '.local/bin'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    join(home, '.asdf/shims'),
    join(home, '.volta/bin'),
    join(home, '.bun/bin'),
    join(home, '.cargo/bin'),
  ].filter((directory) => existsSync(directory))
}

/** Login-shell entries win so agents run the same tools as the user's terminal, then the
 * standard tool locations, then the PATH the app was launched with. */
export function mergePath(
  current: string | undefined,
  login: string | undefined,
  known: readonly string[] = [],
) {
  const entries = [...(login ?? '').split(':'), ...known, ...(current ?? '').split(':')].filter(
    Boolean,
  )
  return [...new Set(entries)].join(':')
}
